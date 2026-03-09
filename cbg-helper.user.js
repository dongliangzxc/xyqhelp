// ==UserScript==
// @name         CBG 捡漏助手 v3.8 (导入导出)
// @namespace    http://tampermonkey.net/
// @version      3.11.2
// @description  宠物/玉魄等历史记录 + 自动扫描 + 筛选方案管理。
// @author       YourName
// @match        *://*.cbg.163.com/*
// @icon         https://cbg.163.com/favicon.ico
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    https://raw.githubusercontent.com/dongliangzxc/xyqhelp/main/cbg-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/dongliangzxc/xyqhelp/main/cbg-helper.user.js
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置常量 ---
    // localStorage 约 5MB（Chrome/Firefox），单条 ~0.5-1KB，约 5000 条。超量可考虑 IndexedDB 迁移
    const HISTORY_KEY = 'cbg_pet_history_v3';
    const CONFIG_KEY = 'cbg_search_configs';
    const HIGHLIGHT_COLOR = '#fff3cd';
    const KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000; // 保活心跳间隔：10 分钟（CBG 会话易过期，缩短间隔）
    const KEEPALIVE_MASTER_KEY = 'cbg_keepalive_master_v1'; // 用于多标签页选主
    const OFFLINE_THRESHOLD_HOURS = 24 * 7; // 一周未刷到→近期未刷到（可能已售/下架，也可能因未搜该类目） // 多少小时未刷到则标记为“可能已下线”（可按需修改）
    const OFFLINE_THRESHOLD_MS = OFFLINE_THRESHOLD_HOURS * 60 * 60 * 1000;
    const SCAN_BATCH_KEY = 'cbg_scan_batch_v1';
    const CO_BATCH_THRESHOLD = 3; // 同批至少 N 个仍刷到，则未刷到的标记为「同批未刷到」
    const AUTO_SCAN_ENABLED_KEY = 'cbg_auto_scan_enabled';

    // 技能缩写映射（宠物胚子常用）
    const SKILL_ABBREV = {
        '高连': '高级连击', '连': '连击', '隐攻': '隐身', '隐': '隐身', '必杀': '必杀', '偷袭': '偷袭',
        '神佑': '神佑复生', '神防': '法术防御', '反震': '反震', '吸血': '吸血', '夜战': '夜战',
        '感知': '感知', '驱鬼': '驱鬼', '鬼魂': '鬼魂术', '再生': '再生', '防御': '防御',
        '敏捷': '敏捷', '强力': '强力', '毒': '毒', '反': '反震', '吸': '吸血', '偷': '偷袭'
    };

    // 各类目搜索页 URL 参考：玉魄 show_overall_search_yupo | 灵饰 show_overall_search_lingshi | 装备 show_overall_search_equip | 召唤兽 /cbg/

    // --- 样式注入 ---
    const style = document.createElement('style');
    style.innerHTML = `
        #cbg-helper-panel {
            position: fixed; top: 80px; right: 20px; width: 220px;
            background: rgba(255, 255, 255, 0.98); border: 1px solid #ccc;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-radius: 8px; padding: 15px;
            z-index: 9999; font-family: "Microsoft YaHei", sans-serif; font-size: 12px;
        }
        #cbg-helper-panel h3 { margin: 10px 0 5px 0; font-size: 14px; font-weight: bold; color: #333; border-bottom: 1px solid #eee; padding-bottom: 5px; }
        #cbg-helper-panel h3:first-child { margin-top: 0; color: #d9534f; }

        .cbg-btn { display: block; width: 100%; padding: 8px 0; margin-bottom: 5px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; transition: 0.2s; }
        .btn-scan { background: #0275d8; color: white; } .btn-scan:hover { background: #025aa5; }
        .btn-view { background: #17a2b8; color: white; } .btn-view:hover { background: #138496; }
        .btn-save { background: #28a745; color: white; } .btn-save:hover { background: #218838; }
        .btn-clear { background: #f8f9fa; color: #666; border: 1px solid #ddd; }

        .config-item { display: flex; justify-content: space-between; align-items: center; background: #f8f9fa; padding: 8px; margin-bottom: 5px; border-radius: 4px; border: 1px solid #eee; }
        .config-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; color: #007bff; font-weight: bold; }
        .config-name:hover { text-decoration: underline; }
        .config-del { color: #dc3545; cursor: pointer; margin-left: 8px; font-weight: bold; padding: 0 5px; }

        #cbg-status { color: #666; margin-top: 5px; border-top: 1px dashed #ddd; padding-top: 5px; text-align: center; }

        /* 历史记录弹窗样式 */
        #cbg-history-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 100000; display: flex; justify-content: center; align-items: center; }
        .modal-content { background: #fff; width: 90%; max-width: 1000px; height: 85%; border-radius: 8px; display: flex; flex-direction: column; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
        .modal-header { padding: 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
        .modal-body { flex: 1; overflow-y: auto; padding: 0; }
        .history-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .history-table th { background-color: #f2f2f2; position: sticky; top: 0; padding: 10px; border-bottom: 2px solid #ddd; z-index: 10; text-align: left;}
        .history-table td { border-bottom: 1px solid #eee; padding: 8px; vertical-align: middle; }
        .history-table tr:hover { background-color: #f9f9f9; }
        .col-price { color: #d9534f; font-weight: bold; font-size: 14px; }
        .col-skills { font-weight: bold; color: #333; }
        .new-tag-badge { background: #ff0000; color: #fff; padding: 2px 5px; border-radius: 4px; font-size: 12px; margin-left: 5px; font-weight: normal;}
        .hm-btn { padding: 4px 8px; margin-right: 4px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 11px; background: #fff; display: inline-block; }
        .hm-btn:hover { background: #eee; }
        .hm-btn-sold { color: #d9534f; border-color: #d9534f; }
        .hm-btn-alive { color: #28a745; border-color: #28a745; }
        .hm-btn-link { text-decoration: none; color: #007bff; }
        .hm-btn-del { color: #dc3545; border-color: #dc3545; }
        .hm-preset { padding:2px 8px;font-size:11px;border:1px solid #ddd;border-radius:4px;cursor:pointer;background:#fff;color:#666; }
        .hm-preset:hover { background:#f0f0f0; }
        .hm-table .col-price { color: #d9534f; font-weight: bold; }
    `;
    document.head.appendChild(style);

    // ==========================================
    // 模块一：筛选配置管理 (v3.4 增强版)
    // ==========================================

    // 关键：这里定义了所有可能包含按钮组的面板ID
    const BUTTON_PANEL_IDS = [
        'level_desc_panel', // 参战等级按钮 (你截图里的那个)
        'race_panel',       // 种族
        'kind_panel',       // 类型
        'fight_level_panel',
        'fair_show_panel',
        'limit_evol_panel'
    ];

    function getConfigs() { try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch(e) { return {}; } }
    function saveConfigs(data) { localStorage.setItem(CONFIG_KEY, JSON.stringify(data)); }

    function saveCurrentConfig() {
        const configName = prompt("请输入配置名称 (例如：70级高连隐攻)：");
        if (!configName) return;

        const config = {
            inputs: {},
            checkboxes: {},
            selects: {}, // 新增：保存下拉菜单
            skills: [],
            notSkills: [],
            buttonLists: {}
        };

        // 1. 保存所有文本输入框 (Text Inputs)
        // 直接扫描整页的 text 输入框，优先使用 id，没有则退回到 name
        document.querySelectorAll('input[type="text"]').forEach(el => {
            const key = el.id || el.name;
            if (key) config.inputs[key] = el.value;
        });

        // 2. 保存所有复选框 (Checkboxes) - 修复"只显示宝宝"等
        document.querySelectorAll('input[type="checkbox"]').forEach(el => {
            const key = el.id || el.name;
            if (key) config.checkboxes[key] = el.checked;
        });

        // 3. 保存下拉菜单 (Selects) - 修复"服务器选择"
        document.querySelectorAll('select').forEach(el => {
            // 尝试保存 ID，如果没有 ID 保存 name，都没有则跳过
            const key = el.id || el.name;
            if(key) config.selects[key] = el.value;
        });

        // 4. 保存选中的技能
        document.querySelectorAll('#pet_skill_wrap li').forEach(li => {
            if (li.classList.contains('active') || li.classList.contains('selected') || li.className.includes('selected')) {
                const skillId = li.getAttribute('data-skill_id'); if (skillId) config.skills.push(skillId);
            }
        });
        // 5. 保存排除的技能
        document.querySelectorAll('#not_pet_skill_wrap li').forEach(li => {
            if (li.classList.contains('active') || li.classList.contains('selected') || li.className.includes('selected')) {
                const skillId = li.getAttribute('data-skill_id'); if (skillId) config.notSkills.push(skillId);
            }
        });

        // 6. 保存按钮组 (如参战等级)
        BUTTON_PANEL_IDS.forEach(panelId => {
            const panel = document.getElementById(panelId); if (!panel) return;
            const selectedIndices = [];
            const lis = panel.querySelectorAll('li');
            lis.forEach((li, index) => {
                const span = li.querySelector('span');
                const a = li.querySelector('a');
                // 更宽松：检查 li / span / a 上是否有常见的激活类
                const activeClasses = ['active', 'selected', 'cur', 'on'];
                const isActive = activeClasses.some(cls =>
                    li.classList.contains(cls) ||
                    (span && span.classList.contains(cls)) ||
                    (a && a.classList.contains(cls)) ||
                    li.className.includes(cls)
                );
                if (isActive) selectedIndices.push(index);
            });
            config.buttonLists[panelId] = selectedIndices;
        });
git
        const allConfigs = getConfigs();
        allConfigs[configName] = config;
        saveConfigs(allConfigs);
        renderConfigList();
        const statusDiv = document.getElementById('cbg-status');
        if (statusDiv) {
            statusDiv.innerHTML = `配置 <b>${configName}</b> 已保存（含全部筛选项）。`;
        }
    }

    function loadConfig(configName) {
        console.log("正在加载配置:", configName);
        const allConfigs = getConfigs();
        const config = allConfigs[configName];
        if (!config) return;

        // 1. 恢复下拉菜单 (Selects) - 先恢复这个，因为可能影响后续
        if (config.selects) {
            // 特殊处理：区服选择需要先切大区，再切服务器，中间给一点时间让服务器列表刷新
            let serverSelectConfig = null; // { key, value }
            for (const [key, value] of Object.entries(config.selects)) {
                // 先记住服务器下拉框，稍后再恢复
                if (key === 'ovarall_sel_server') { // 注意：页面上的 id 就是这个拼写
                    serverSelectConfig = { key, value };
                    continue;
                }
                // 尝试通过 ID 或 Name 找元素
                let el = document.getElementById(key);
                if (!el) el = document.querySelector(`select[name="${key}"]`);

                if (el) {
                    el.value = value;
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }

            // 延时恢复服务器下拉，确保大区切换完成并且服务器列表刷新完毕
            if (serverSelectConfig) {
                setTimeout(() => {
                    let el = document.getElementById(serverSelectConfig.key);
                    if (!el) el = document.querySelector(`select[name="${serverSelectConfig.key}"]`);
                    if (el) {
                        el.value = serverSelectConfig.value;
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, 600);
            }
        }

        // 2. 恢复输入框
        for (const [key, value] of Object.entries(config.inputs)) {
            // 先按 id 找，不存在再按 name 找，兼容老配置与新配置
            let el = document.getElementById(key);
            if (!el) el = document.querySelector(`input[type="text"][name="${key}"]`);
            if (el) {
                el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        // 3. 恢复复选框 (包括"只显示宝宝")
        for (const [key, checked] of Object.entries(config.checkboxes)) {
            // 同样先按 id，再按 name 查找
            let el = document.getElementById(key);
            if (!el) el = document.querySelector(`input[type="checkbox"][name="${key}"]`);
            if (el) {
                el.checked = checked;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                // 有些复选框仅在 click 事件中做额外逻辑，这里保证状态一致时也触发一次点击
                if (el.checked !== checked) {
                    el.click();
                }
            }
        }

        // 4. 恢复技能选择
        document.querySelectorAll('#pet_skill_wrap li').forEach(li => {
            const skillId = li.getAttribute('data-skill_id');
            const shouldSelect = config.skills.includes(skillId);
            const isSelected = li.classList.contains('active') || li.classList.contains('selected') || li.className.includes('selected');
            if ((shouldSelect && !isSelected) || (!shouldSelect && isSelected)) li.click();
        });

        document.querySelectorAll('#not_pet_skill_wrap li').forEach(li => {
            const skillId = li.getAttribute('data-skill_id');
            const shouldSelect = config.notSkills.includes(skillId);
            const isSelected = li.classList.contains('active') || li.classList.contains('selected') || li.className.includes('selected');
            if ((shouldSelect && !isSelected) || (!shouldSelect && isSelected)) li.click();
        });

        // 5. 恢复按钮组 (包括"参战等级")
        for (const [panelId, indices] of Object.entries(config.buttonLists)) {
            const panel = document.getElementById(panelId); if (!panel) continue;
            const lis = panel.querySelectorAll('li');
            lis.forEach((li, index) => {
                const span = li.querySelector('span');
                const a = li.querySelector('a');
                const activeClasses = ['active', 'selected', 'cur', 'on'];
                const isSelected = activeClasses.some(cls =>
                    li.classList.contains(cls) ||
                    (span && span.classList.contains(cls)) ||
                    (a && a.classList.contains(cls)) ||
                    li.className.includes(cls)
                );
                const shouldSelect = indices.includes(index);

                // 只有状态不一致时才点击，避免重复取消
                if ((shouldSelect && !isSelected) || (!shouldSelect && isSelected)) {
                    (span || li).click();
                }
            });
        }

        // 6. 尝试触发搜索
        setTimeout(() => {
            const searchBtn = document.querySelector('.btn_search') || document.querySelector('#btn_search');
            if(searchBtn) {
                console.log("自动点击搜索...");
                searchBtn.click();
            } else {
                const statusDiv = document.getElementById('cbg-status');
                if (statusDiv) {
                    statusDiv.innerHTML = `配置已填入，请手动点击页面上的"搜索"按钮。`;
                }
            }
        }, 800); // 稍微延时一点，等待DOM响应
    }

    // 一键重置当前页面上的所有筛选条件（不影响已保存的方案）
    function resetCurrentFilters() {
        const statusDiv = document.getElementById('cbg-status');
        if (statusDiv) statusDiv.innerHTML = '正在重置筛选条件...';

        // 1. 清空所有文本输入框
        document.querySelectorAll('input[type="text"]').forEach(el => {
            if (el.value !== '') {
                el.value = '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        // 2. 取消所有复选框
        document.querySelectorAll('input[type="checkbox"]').forEach(el => {
            if (el.checked) {
                el.checked = false;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        // 3. 重置所有下拉框
        document.querySelectorAll('select').forEach(el => {
            if (el.selectedIndex !== 0) {
                el.selectedIndex = 0;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        // 4. 取消所有技能选择（包含"包含技能"和"不含技能"、等同高级技能等）
        const skillSelectors = [
            '#pet_skill_wrap li',
            '#not_pet_skill_wrap li',
            '#pet_equal_advanced_skill_panel li'
        ];
        skillSelectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(li => {
                const isSelected = li.classList.contains('active') ||
                                   li.classList.contains('selected') ||
                                   li.className.includes('selected');
                if (isSelected) li.click();
            });
        });

        // 5. 取消所有按钮组（参战等级 / 出售状态 / 赐福技能 / 内丹 / 特性等）
        document.querySelectorAll('.btnList li').forEach(li => {
            if (li.classList.contains('disable')) return; // 跳过灰掉的
            const span = li.querySelector('span');
            const a = li.querySelector('a');
            const activeClasses = ['active', 'selected', 'cur', 'on'];
            const isSelected = activeClasses.some(cls =>
                li.classList.contains(cls) ||
                (span && span.classList.contains(cls)) ||
                (a && a.classList.contains(cls)) ||
                li.className.includes(cls)
            );
            if (isSelected) {
                (span || li).click();
            }
        });

        if (statusDiv) statusDiv.innerHTML = '已重置当前筛选条件。';
    }

    // ==========================================
    // 模块一补充：会话保活（防止长时间无操作掉线）
    // ==========================================

    let keepAliveTimer = null;
    const TAB_ID = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

    // 判断当前标签页是否应当作为“保活主标签页”
    function isKeepAliveMaster() {
        try {
            const raw = localStorage.getItem(KEEPALIVE_MASTER_KEY);
            if (!raw) return true; // 没有记录，当前标签可以成为主
            const data = JSON.parse(raw);
            const now = Date.now();

            // 记录已过期，当前标签可以抢占为主
            if (!data.ts || (now - data.ts) > KEEPALIVE_INTERVAL_MS * 1.5) {
                return true;
            }

            // 自己就是主
            return data.id === TAB_ID;
        } catch (e) {
            return true;
        }
    }

    function updateKeepAliveMasterStamp() {
        try {
            localStorage.setItem(KEEPALIVE_MASTER_KEY, JSON.stringify({
                id: TAB_ID,
                ts: Date.now()
            }));
        } catch (e) {
            // 忽略本地存储异常
        }
    }

    function startKeepAlive() {
        if (keepAliveTimer) return; // 避免重复启动

        const statusDiv = document.getElementById('cbg-status');

        const sendPing = () => {
            // 只有“主标签页”才真正发心跳，避免多标签页一起打请求
            if (!isKeepAliveMaster()) {
                return;
            }

            // 抢占/续约主标签身份
            updateKeepAliveMasterStamp();

            // 请求 cbg 主路径以刷新会话（/cbg/ 或当前页）
            const pingUrl = (location.pathname.includes('/cbg/') && !location.pathname.includes('/equip')) ? location.href : (location.origin + '/cbg/');
            fetch(pingUrl, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                headers: { 'Accept': 'text/html' }
            }).then(() => {
                updateKeepAliveMasterStamp(); // 成功后再续约一次时间戳
                if (statusDiv) {
                    const t = new Date().toLocaleTimeString();
                    statusDiv.innerHTML = `保活中：最近心跳 ${t}（每 ${KEEPALIVE_INTERVAL_MS / 60000} 分钟，仅主标签生效）`;
                }
            }).catch(() => {
                if (statusDiv) {
                    const t = new Date().toLocaleTimeString();
                    statusDiv.innerHTML = `保活心跳失败 ${t}，稍后自动重试`;
                }
            });
        };

        doKeepAlivePing();
        keepAliveTimer = setInterval(doKeepAlivePing, KEEPALIVE_INTERVAL_MS);
    }

    function doKeepAlivePing() {
        const statusDiv = document.getElementById('cbg-status');
        if (!isKeepAliveMaster()) {
            if (statusDiv) statusDiv.innerHTML = '保活：当前非主标签';
            return;
        }
        updateKeepAliveMasterStamp();
        const pingUrl = (location.pathname.includes('/cbg/') && !location.pathname.includes('/equip')) ? location.href : (location.origin + '/cbg/');
        fetch(pingUrl, { method: 'GET', credentials: 'include', cache: 'no-store', headers: { 'Accept': 'text/html' } })
            .then(() => {
                updateKeepAliveMasterStamp();
                if (statusDiv) statusDiv.innerHTML = '保活：最近心跳 ' + new Date().toLocaleTimeString() + '（每' + (KEEPALIVE_INTERVAL_MS/60000) + '分钟）';
            })
            .catch(() => {
                if (statusDiv) statusDiv.innerHTML = '保活失败 ' + new Date().toLocaleTimeString();
            });
    }

    function deleteConfig(configName) {
        if (!confirm(`确定删除配置 "${configName}" 吗？`)) return;
        const allConfigs = getConfigs();
        delete allConfigs[configName];
        saveConfigs(allConfigs);
        renderConfigList();
    }

    function renderConfigList() {
        const container = document.getElementById('config-list-container');
        if (!container) return;
        const allConfigs = getConfigs();
        let html = '';
        for (const name of Object.keys(allConfigs)) {
            html += `
                <div class="config-item">
                    <span class="config-name" data-action="load" data-name="${name}">📂 ${name}</span>
                    <span class="config-del" data-action="del" data-name="${name}">×</span>
                </div>`;
        }
        if (html === '') html = '<div style="color:#999;text-align:center;padding:10px;">暂无保存的配置</div>';
        container.innerHTML = html;
    }


    // ==========================================
    // 模块二：历史记录与扫描 (保持 v3.3 的精准版)
    // ==========================================

    function parsePetRow(row) {
        const imgTag = row.querySelector('img[data_ordersn]');
        if (!imgTag) return null;

        const orderSn = imgTag.getAttribute('data_ordersn');
        const serverid = imgTag.getAttribute('data_serverid');
        const name = imgTag.getAttribute('data_equip_name');
        const price = parseFloat(imgTag.getAttribute('data_price'));

        let link = "";
        const linkTag = row.querySelector('a.equip-list-item-link') || row.querySelector('a.product_item_link') || row.querySelector('a');
        if(linkTag && linkTag.href && linkTag.href.indexOf('javascript') === -1) link = linkTag.href;
        else link = `https://xyq.cbg.163.com/equip?s=${serverid}&eid=${orderSn}`;

        let gongzi = "-";
        let chengzhang = "-";
        let skillNum = 0;

        let skills = [];
        const textArea = row.querySelector('textarea');
        if (textArea) {
            try {
                const rawData = JSON.parse(textArea.value);
                if (rawData.growth) chengzhang = (rawData.growth / 1000).toFixed(3);
                if (rawData.desc) {
                    const match = rawData.desc.match(/csavezz\\?":\\?"(\d+)/);
                    if (match && match[1]) gongzi = match[1];
                }
                if (rawData.skill_num) skillNum = rawData.skill_num;
                // 解析技能名：尝试多种常见结构
                if (Array.isArray(rawData.pet_skill)) {
                    skills = rawData.pet_skill.map(s => s.name || s.skill_name || s).filter(Boolean);
                } else if (Array.isArray(rawData.skill_list)) {
                    skills = rawData.skill_list.map(s => typeof s === 'object' ? (s.name || s.skill_name) : s).filter(Boolean);
                } else if (typeof rawData.skill === 'string') {
                    skills = rawData.skill.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
                } else if (rawData.skills && Array.isArray(rawData.skills)) {
                    skills = rawData.skills.map(s => typeof s === 'object' ? (s.name || s.skill_name) : s).filter(Boolean);
                }
                if (skills.length === 0 && rawData.desc) {
                    const skillMatch = rawData.desc.match(/skill_name\\?":\\?"([^"]+)/g);
                    if (skillMatch) skills = skillMatch.map(m => (m.match(/"([^"]+)$/) || [])[1]).filter(Boolean);
                }
            } catch (e) { console.error("JSON解析失败", e); }
        }
        if (skills.length === 0) {
            const skillEls = row.querySelectorAll('[data-skill_name], .skill-name, .pet-skill-name');
            skillEls.forEach(el => {
                const n = el.getAttribute('data-skill_name') || el.textContent?.trim();
                if (n) skills.push(n);
            });
        }

        return {
            id: orderSn,
            name,
            price,
            gongzi,
            chengzhang,
            skillNum: skillNum,
            skills: skills.length ? skills : null,
            link,
            serverid: serverid || null,
            itemType: 'pet',
            lastSeen: new Date().toLocaleString()
        };
    }

    /** 解析上古玉魄行（与宠物共用 tr[log-exposure]，通过 data_equip_name 含「玉魄」区分） */
    function parseYupoRow(row) {
        const imgTag = row.querySelector('img[data_ordersn]');
        if (!imgTag) return null;

        const orderSn = imgTag.getAttribute('data_ordersn');
        const serverid = imgTag.getAttribute('data_serverid');
        const name = imgTag.getAttribute('data_equip_name');
        const price = parseFloat(imgTag.getAttribute('data_price'));

        let link = "";
        const linkTag = row.querySelector('a.soldImg') || row.querySelector('a.equip-list-item-link') || row.querySelector('a[href*="equip"]') || row.querySelector('a');
        if (linkTag && linkTag.href && linkTag.href.indexOf('javascript') === -1) link = linkTag.href;
        else link = `https://xyq.cbg.163.com/equip?s=${serverid}&eid=${orderSn}`;

        let summary = "-";
        let attrs = [];
        const textAreas = row.querySelectorAll('textarea');
        for (const ta of textAreas) {
            try {
                let str = ta.value || '';
                const jsonMatch = str.match(/\{[\s\S]*\}/);
                if (jsonMatch) str = jsonMatch[0];
                const raw = JSON.parse(str);
                if (raw.summary) summary = raw.summary;
                if (Array.isArray(raw.agg_added_attrs)) attrs = raw.agg_added_attrs;
                else if (raw.minghun && raw.minghun.base) {
                    attrs = raw.minghun.base.map(b => b.desc).filter(Boolean);
                }
                if (attrs.length || summary !== '-') break;
            } catch (e) {}
        }
        if (attrs.length === 0) {
            const attrCells = row.querySelectorAll('td p');
            attrCells.forEach(p => { const t = p.textContent?.trim(); if (t && /^[\u4e00-\u9fa5]+\s*[+\-]?\d+/.test(t)) attrs.push(t); });
        }

        return {
            id: orderSn,
            name,
            price,
            summary,
            attrs: attrs.length ? attrs : null,
            link,
            serverid: serverid || null,
            itemType: 'yupo',
            lastSeen: new Date().toLocaleString()
        };
    }

    /** 解析灵饰行（耳饰/戒指/手镯/佩饰，通过 data_equip_type_desc 或 main_attrs 识别） */
    function parseLingshiRow(row) {
        const imgTag = row.querySelector('img[data_ordersn]');
        if (!imgTag) return null;

        const orderSn = imgTag.getAttribute('data_ordersn');
        const serverid = imgTag.getAttribute('data_serverid');
        const name = imgTag.getAttribute('data_equip_name');
        const price = parseFloat(imgTag.getAttribute('data_price'));
        const level = imgTag.getAttribute('data_equip_level') || null;

        let link = "";
        const linkTag = row.querySelector('a.soldImg') || row.querySelector('a.equip-list-item-link') || row.querySelector('a[href*="equip"]') || row.querySelector('a');
        if (linkTag && linkTag.href && linkTag.href.indexOf('javascript') === -1) link = linkTag.href;
        else link = `https://xyq.cbg.163.com/equip?s=${serverid}&eid=${orderSn}`;

        let summary = "-";
        let mainAttr = "-";
        let jinglianLevel = null;
        let attrs = [];
        const textAreas = row.querySelectorAll('textarea');
        for (const ta of textAreas) {
            try {
                let str = ta.value || '';
                const jsonMatch = str.match(/\{[\s\S]*\}/);
                if (jsonMatch) str = jsonMatch[0];
                const raw = JSON.parse(str);
                if (raw.summary) summary = raw.summary;
                if (raw.jinglian_level != null) jinglianLevel = raw.jinglian_level;
                if (Array.isArray(raw.main_attrs) && raw.main_attrs.length) {
                    mainAttr = raw.main_attrs.map(a => Array.isArray(a) ? a.join(' ') : a).join(' ');
                }
                if (Array.isArray(raw.agg_added_attrs)) {
                    attrs = raw.agg_added_attrs.flatMap(s => {
                        const m = String(s).match(/[\u4e00-\u9fa5]+\s*[+\-]?\d+/g);
                        return m || (s ? [s] : []);
                    });
                }
                if (summary !== '-' || attrs.length) break;
            } catch (e) {}
        }
        if (attrs.length === 0) {
            const attrMatch = row.innerHTML.match(/[\u4e00-\u9fa5]+\s*\+\d+(?:\s*\[\+\d+\])?/g);
            if (attrMatch) attrs = [...new Set(attrMatch)];
        }

        return {
            id: orderSn,
            name,
            price,
            level,
            mainAttr,
            jinglianLevel,
            summary,
            attrs: attrs.length ? attrs : null,
            link,
            serverid: serverid || null,
            itemType: 'lingshi',
            lastSeen: new Date().toLocaleString()
        };
    }

    /** 解析装备行（武器/防具等，有 gem_level/hole_num，与灵饰的 jinglian_level 区分） */
    function parseEquipRow(row) {
        const imgTag = row.querySelector('img[data_ordersn]');
        if (!imgTag) return null;

        const orderSn = imgTag.getAttribute('data_ordersn');
        const serverid = imgTag.getAttribute('data_serverid');
        const name = imgTag.getAttribute('data_equip_name');
        const price = parseFloat(imgTag.getAttribute('data_price'));
        const level = imgTag.getAttribute('data_equip_level') || null;

        let link = "";
        const linkTag = row.querySelector('a.soldImg') || row.querySelector('a.equip-list-item-link') || row.querySelector('a[href*="equip"]') || row.querySelector('a');
        if (linkTag && linkTag.href && linkTag.href.indexOf('javascript') === -1) link = linkTag.href;
        else link = `https://xyq.cbg.163.com/equip?s=${serverid}&eid=${orderSn}`;

        let summary = "-";
        let mainAttr = "-";
        let gemLevel = null;
        let holeNum = null;
        let teji = null;
        let taozhuang = null;
        let attrs = [];

        const textAreas = row.querySelectorAll('textarea');
        for (const ta of textAreas) {
            try {
                let str = ta.value || '';
                const jsonMatch = str.match(/\{[\s\S]*\}/);
                if (jsonMatch) str = jsonMatch[0];
                const raw = JSON.parse(str);
                if (raw.summary) summary = raw.summary;
                if (raw.gem_level != null) gemLevel = raw.gem_level;
                if (raw.hole_num != null) holeNum = raw.hole_num;
                if (Array.isArray(raw.main_attrs) && raw.main_attrs.length) {
                    mainAttr = raw.main_attrs.map(a => Array.isArray(a) ? a.join(' ') : a).join(' ');
                }
                if (Array.isArray(raw.melt_attrs) && raw.melt_attrs.length) {
                    attrs = raw.melt_attrs.map(a => Array.isArray(a) ? a.join(' ') : a);
                } else if (Array.isArray(raw.agg_added_attrs)) {
                    attrs = raw.agg_added_attrs.flatMap(s => {
                        const m = String(s).match(/[\u4e00-\u9fa5]+\s*[+\-]?\d+/g);
                        return m || (s ? [s] : []);
                    });
                }
                if (summary !== '-' || gemLevel != null) break;
            } catch (e) {}
        }

        const highlightsStr = imgTag.getAttribute('data_highlights') || '';
        try {
            const decoded = highlightsStr.replace(/&quot;/g, '"');
            const arr = JSON.parse(decoded);
            if (Array.isArray(arr)) {
                arr.forEach(h => {
                    const txt = Array.isArray(h) ? h[0] : '';
                    const key = (h && h[2] && h[2].key) || '';
                    if (/锻|级/.test(txt)) return;
                    if (/套装$/.test(txt)) taozhuang = txt.replace(/套装$/, '');
                    else if (key.includes('teji') || (txt && !teji && !taozhuang && /^[\u4e00-\u9fa5]{2,8}$/.test(txt))) teji = txt;
                });
            }
        } catch (e) {}
        if (!teji && !taozhuang) {
            const tds = row.querySelectorAll('td');
            const seen = new Set();
            tds.forEach(td => {
                const t = td.textContent?.trim();
                if (t && /^[\u4e00-\u9fa5]{2,8}$/.test(t) && !seen.has(t) && !/玛瑙|翡翠|太阳|月亮|黑宝|红纹|黄晶|绿宝|蓝宝|紫晶|锻炼/.test(t)) {
                    seen.add(t);
                    if (t.endsWith('套装')) taozhuang = t.replace(/套装$/, '');
                    else if (!teji) teji = t;
                }
            });
        }

        return {
            id: orderSn,
            name,
            price,
            level,
            mainAttr,
            gemLevel,
            holeNum,
            summary,
            teji: teji || null,
            taozhuang: taozhuang || null,
            attrs: attrs.length ? attrs : null,
            link,
            serverid: serverid || null,
            itemType: 'equip',
            lastSeen: new Date().toLocaleString()
        };
    }

    /** 统一解析：根据名称/结构自动识别宠物、玉魄、灵饰或装备 */
    function parseItemRow(row) {
        const imgTag = row.querySelector('img[data_ordersn]');
        if (!imgTag) return null;
        const name = imgTag.getAttribute('data_equip_name') || '';
        const typeDesc = imgTag.getAttribute('data_equip_type_desc') || '';
        if (/上古玉魄|玉魄/.test(name)) return parseYupoRow(row);
        if (/耳饰|戒指|手镯|佩饰/.test(typeDesc)) return parseLingshiRow(row);
        const ta = row.querySelector('textarea');
        if (ta) {
            try {
                const jsonMatch = (ta.value || '').match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const raw = JSON.parse(jsonMatch[0]);
                    if (raw.gem_level != null || raw.hole_num != null) return parseEquipRow(row);
                    if (raw.jinglian_level != null) return parseLingshiRow(row);
                }
            } catch (e) {}
        }
        return parsePetRow(row);
    }

    /** 检测当前列表是否按「价格从低到高」排序。返回 'price_asc' | 'price_desc' | 'unknown' */
    function detectSortOrder(pricesFromPage) {
        const q = new URLSearchParams(location.search);
        const order = (q.get('order') || q.get('sort') || q.get('order_by') || '').toLowerCase();
        if (/price_asc|priceasc|asc|低价|升序/.test(order)) return 'price_asc';
        if (/price_desc|pricedesc|desc|高价|降序/.test(order)) return 'price_desc';

        // DOM：表头「价格↑」= 价格从低到高，「价格↓」= 价格从高到低（CBG 表头排序链接）
        const priceLink = [...document.querySelectorAll('th a, th, a[data_attr_name="price"]')].find(n =>
            n.textContent && /价格\s*↑/.test(n.textContent.trim())
        );
        if (priceLink) return 'price_asc';
        const priceDescLink = [...document.querySelectorAll('th a, th, a[data_attr_name="price"]')].find(n =>
            n.textContent && /价格\s*↓/.test(n.textContent.trim())
        );
        if (priceDescLink) return 'price_desc';

        // DOM：其他排序控件中「价格从低到高」是否被选中
        const sortTexts = ['价格从低到高', '价格升序', '低价优先', '价格从低到高排序'];
        for (const txt of sortTexts) {
            const el = [...document.querySelectorAll('a, span, li, .sort-item, [class*="sort"]')].find(n =>
                n.textContent && n.textContent.trim().includes(txt) &&
                (n.classList.contains('active') || n.classList.contains('cur') || n.classList.contains('on') || n.classList.contains('selected'))
            );
            if (el) return 'price_asc';
        }

        // 数据启发式：用本页价格判断（至少 3 条才有参考价值）
        if (Array.isArray(pricesFromPage) && pricesFromPage.length >= 3) {
            let asc = true, desc = true;
            for (let i = 1; i < pricesFromPage.length; i++) {
                const a = pricesFromPage[i - 1], b = pricesFromPage[i];
                if (a > b) asc = false;
                if (a < b) desc = false;
            }
            if (asc && !desc) return 'price_asc';
            if (desc && !asc) return 'price_desc';
        }
        return 'unknown';
    }

    /** 自动扫描：仅当「价格从低到高」时才执行，当前页扫过一次即停，翻页/新页再扫 */
    let lastAutoScanPageId = null;

    function isAutoScanEnabled() {
        try {
            const v = localStorage.getItem(AUTO_SCAN_ENABLED_KEY);
            return v === null || v === 'true';
        } catch (e) { return true; }
    }
    function setAutoScanEnabled(enabled) {
        try { localStorage.setItem(AUTO_SCAN_ENABLED_KEY, String(enabled)); } catch (e) {}
    }

    function getCurrentPageId(rows) {
        const ids = [];
        rows.forEach(row => {
            const d = parseItemRow(row);
            if (d && d.id) ids.push(d.id);
        });
        return location.href + '|' + ids.join(',');
    }

    function tryAutoScan() {
        if (!isAutoScanEnabled()) return;
        if (!document.getElementById('cbg-helper-panel')) return;
        const rows = document.querySelectorAll('tr[log-exposure], .equip-list-item, .list-item');
        if (rows.length === 0) return;

        // 当前页已扫过则不再扫（避免 MutationObserver 因广告等 DOM 变化反复触发）
        const pageId = getCurrentPageId(rows);
        if (pageId === lastAutoScanPageId) return;

        // 先检测排序：只有「价格从低到高」才自动扫描
        const pricesOnPage = [];
        rows.forEach(row => {
            const d = parseItemRow(row);
            if (d && typeof d.price === 'number') pricesOnPage.push(d.price);
        });
        const sortOrder = detectSortOrder(pricesOnPage);
        if (sortOrder !== 'price_asc') return;

        lastAutoScanPageId = pageId;
        runScan(true);
    }

    function startAutoScanObserver() {
        let debounceTimer;
        const obs = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(tryAutoScan, 600);
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    function runScan(isAutoScan = false) {
        const statusDiv = document.getElementById('cbg-status');
        statusDiv.innerHTML = "正在提取数据...";
        let history = getHistory();

        const now = new Date().toLocaleString();

        // 扫描批次号：每次点击“扫描当前页”自增一次，用于区分哪一批已经验证过
        let batch = 0;
        try {
            batch = parseInt(localStorage.getItem(SCAN_BATCH_KEY) || '0', 10) || 0;
        } catch (e) {
            batch = 0;
        }
        batch += 1;
        try {
            localStorage.setItem(SCAN_BATCH_KEY, String(batch));
        } catch (e) {}
        const currentBatch = batch;

        const rows = document.querySelectorAll('tr[log-exposure], .equip-list-item, .list-item');
        if (rows.length === 0) {
            statusDiv.innerHTML = "⚠️ 未找到列表";
            return;
        }

        // 先收集本页所有 id、最高价、价格序列，用于「同批未刷到」检测及排序判断
        const currentScanIds = new Set();
        let maxPriceOnPage = 0;
        const pricesOnPage = [];
        rows.forEach(row => {
            const d = parseItemRow(row);
            if (d) {
                currentScanIds.add(d.id);
                if (typeof d.price === 'number') {
                    if (d.price > maxPriceOnPage) maxPriceOnPage = d.price;
                    pricesOnPage.push(d.price);
                }
            }
        });

        // 排序检测：若非「价格从低到高」，提示用户手动切换
        const sortOrder = detectSortOrder(pricesOnPage);
        if (sortOrder !== 'price_asc') {
            const msg = sortOrder === 'price_desc'
                ? '⚠️ 当前为「价格从高到低」，建议切到「价格从低到高」再扫描'
                : '⚠️ 当前可能非「价格从低到高」，建议手动切换后再扫描';
            showToast(msg);
        }

        // 同批未刷到：与当前页多数同批的，但本页没刷到 → 大概率已售/下架
        // 排除：若缺失项价格高于本页最高价，说明可能被低价挤到下一页，不标记
        let inferredCount = 0;
        Object.keys(history).forEach(id => {
            if (currentScanIds.has(id)) return;
            const item = history[id];
            const batch = item.scanBatch || 0;
            if (!batch) return;
            if (maxPriceOnPage > 0 && typeof item.price === 'number' && item.price > maxPriceOnPage) return; // 价格高于本页最高，可能在下页
            let coCount = 0;
            currentScanIds.forEach(cid => {
                if ((history[cid] || {}).scanBatch === batch) coCount++;
            });
            if (coCount >= CO_BATCH_THRESHOLD) {
                history[id] = { ...item, inferredOffline: true, inferredOfflineAt: new Date().toLocaleDateString() };
                inferredCount++;
            }
        });

        let newCount = 0;
        let priceChangeCount = 0;

        rows.forEach(row => {
            const data = parseItemRow(row);
            if(!data) return;

            const old = history[data.id];
            const isNew = !old;
            const priceChanged = !!old && old.price !== data.price;

            row.style.backgroundColor = "";
            const oldBadge = row.querySelector('.new-tag-badge');
            if(oldBadge) oldBadge.remove();

            if(isNew) {
                newCount++;
                row.style.backgroundColor = HIGHLIGHT_COLOR;
                const priceArea = row.querySelector('.price') || row.querySelector('.equip-price') || row.querySelector('td:nth-child(3)') || row.querySelector('td:nth-child(6)') || [...row.querySelectorAll('td')].find(td => td.textContent && /￥|¥/.test(td.textContent));
                if(priceArea) {
                    const badge = document.createElement('span');
                    badge.className = 'new-tag-badge';
                    badge.innerText = 'NEW!';
                    priceArea.appendChild(badge);
                }
                // 新记录：初始化时间信息
                history[data.id] = {
                    ...data,
                    firstSeen: now,
                    firstSeenDate: new Date().toLocaleDateString(),
                    lastSeen: now,
                    lastPriceChange: now,
                    lastScannedAt: now,
                    scanBatch: currentBatch,
                    prevPrice: null
                };
            } else {
                // 已存在记录
                if (priceChanged) {
                    priceChangeCount++;
                    row.style.backgroundColor = HIGHLIGHT_COLOR;
                    const priceArea = row.querySelector('.price') || row.querySelector('.equip-price') || row.querySelector('td:nth-child(3)') || row.querySelector('td:nth-child(6)') || [...row.querySelectorAll('td')].find(td => td.textContent && /￥|¥/.test(td.textContent));
                    if(priceArea) {
                        const badge = document.createElement('span');
                        badge.className = 'new-tag-badge';
                        badge.innerText = '上次 ¥' + old.price;
                        badge.title = '上次看到的价格';
                        priceArea.appendChild(badge);
                    }

                    history[data.id] = {
                        ...old,
                        ...data,
                        prevPrice: old.price,
                        price: data.price,
                        lastSeen: now,
                        lastPriceChange: now,
                        lastScannedAt: now,
                        scanBatch: currentBatch
                    };
                    delete history[data.id].inferredOffline;
                } else {
                    // 价格未变：只更新非价格类字段 + 上次刷到时间
                    history[data.id] = {
                        ...old,
                        gongzi: data.gongzi,
                        chengzhang: data.chengzhang,
                        skillNum: data.skillNum,
                        skills: data.skills ?? old.skills,
                        link: data.link,
                        serverid: data.serverid ?? old.serverid,
                        lastScannedAt: now,
                        scanBatch: currentBatch
                    };
                    delete history[data.id].inferredOffline;
                }
            }
        });
        saveHistory(history);
        const total = Object.keys(history).length;
        let statusMsg = `本次扫描: 新增 <b style="color:red">${newCount}</b> | 价格变动 <b style="color:#d9534f">${priceChangeCount}</b>`;
        if (inferredCount) statusMsg += ` | 同批未刷到 <b style="color:#dc3545">${inferredCount}</b>`;
        statusMsg += ` | 已记录 ${total}`;
        if (isAutoScan) {
            statusMsg += ` | <span style="color:#17a2b8">✓ 已自动扫描</span>`;
            showToast('已自动扫描');
        }
        if (sortOrder !== 'price_asc') statusMsg += `<br><span style="color:#d9534f">${sortOrder === 'price_desc' ? '当前为价格从高到低' : '当前可能非价格从低到高'}，建议手动切换</span>`;
        statusDiv.innerHTML = statusMsg;
        refreshDailyStats();
    }

    function _removed_showHistory() {
        const history = getHistory();
        const items = Object.values(history);
        items.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

        const fmtTime = (s) => {
            if (!s) return '-';
            const parts = String(s).split(' ');
            return parts.length >= 2 ? `${parts[0]}<br>${parts[1]}` : s;
        };
        const parseTime = (s) => {
            if (!s) return 0;
            const t = Date.parse(s);
            return isNaN(t) ? 0 : t;
        };

        const nowTs = Date.now();
        // 最近一批扫描的批次号（数值越大越新）
        let latestBatch = 0;
        items.forEach(item => {
            const b = item.scanBatch || 0;
            if (b > latestBatch) latestBatch = b;
        });

        let rowsHtml = items.map((item, index) => {
            const hasPriceChange = item.prevPrice != null && item.prevPrice !== item.price;
            const priceHtml = hasPriceChange
                ? `¥ ${item.price} <span style="color:#999;font-size:11px;text-decoration:line-through;margin-left:4px;">(原 ¥ ${item.prevPrice})</span>`
                : `¥ ${item.price}`;
            const priceUpdateTime = item.lastPriceChange || '-';
            const lastScannedTime = item.lastScannedAt || item.lastSeen || '-';
            const lastScanTs = parseTime(lastScannedTime);
            const batch = item.scanBatch || 0;

            let statusText = '状态未知';
            let statusColor = '#999';
            // 1. 先用批次标记 “本批已刷到 / 历史批次”
            if (batch && latestBatch) {
                if (batch === latestBatch) {
                    statusText = '本批已刷到';
                    statusColor = '#28a745';
                } else {
                    statusText = '历史批次（需再验证）';
                    statusColor = '#f0ad4e';
                }
            }

            // 2. 如果时间非常久没刷到，则进一步标记为“可能已下线”
            if (lastScanTs) {
                const diffMs = nowTs - lastScanTs;
                if (diffMs > OFFLINE_THRESHOLD_MS) {
                    statusText = '近期未刷到';
                    statusColor = '#d9534f';
                }
            }

            return `
            <tr id="row-${item.id}">
                <td>${index + 1}</td>
                <td style="font-weight:bold; color:#007bff">${item.name}</td>
                <td class="col-price">${priceHtml}</td>
                <td class="col-attr">攻: ${item.gongzi}<br>成: ${item.chengzhang}</td>
                <td class="col-skills">${item.skillNum} 技能</td>
                <td style="font-size:11px; color:#999">
                    价格更新: ${fmtTime(priceUpdateTime)}<br>
                    上次刷到: ${fmtTime(lastScannedTime)}<br>
                    <span style="color:${statusColor}">标记：${statusText}</span>
                </td>
                <td>
                    <a href="${item.link}" target="_blank" style="color:green;margin-right:5px">[查看]</a>
                    <a href="javascript:void(0)" class="del-btn" data-id="${item.id}" style="color:red">[删除]</a>
                </td>
            </tr>
        `;
        }).join('');

        if (items.length === 0) rowsHtml = '<tr><td colspan="7" style="text-align:center;padding:20px">暂无数据</td></tr>';

        const modalHtml = `
            <div id="cbg-history-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>📦 召唤兽历史库 (${items.length})</h2>
                        <span class="close-btn" style="cursor:pointer;font-size:24px" id="close-modal">&times;</span>
                    </div>
                    <div class="modal-body">
                        <table class="history-table">
                            <thead><tr><th>#</th><th>名称</th><th>价格</th><th>资质/成长</th><th>技能数</th><th>价格更新 / 上次刷到</th><th>操作</th></tr></thead>
                            <tbody>${rowsHtml}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        const old = document.getElementById('cbg-history-modal');
        if(old) old.remove();
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById('cbg-history-modal');
        modal.addEventListener('click', (e) => {
            if(e.target.id === 'cbg-history-modal' || e.target.id === 'close-modal') modal.remove();
            if(e.target.classList.contains('del-btn')) {
                const id = e.target.getAttribute('data-id');
                deleteItem(id);
            }
        });
    }

    function getHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); } catch(e) { return {}; } }
    function saveHistory(data) { localStorage.setItem(HISTORY_KEY, JSON.stringify(data)); }
    function clearHistory() { if(confirm('清空所有记录？')) { localStorage.removeItem(HISTORY_KEY); location.reload(); } }
    function deleteItem(id) {
        let history = getHistory();
        if(history[id]) { delete history[id]; saveHistory(history); const row = document.getElementById('row-' + id); if(row) row.remove(); }
    }

    function updateItemManualStatus(id, status, soldPrice) {
        const history = getHistory();
        if (!history[id]) return;
        history[id].manualStatus = status || null;
        if (status === 'sold') {
            if (soldPrice != null) history[id].soldPrice = soldPrice;
            history[id].soldAt = new Date().toLocaleDateString();
        } else {
            delete history[id].soldPrice;
            delete history[id].soldAt;
        }
        // 已手动标记则清除「同批未刷到」，不再显示推断状态
        if (status === 'sold' || status === 'alive' || status === 'offline') {
            delete history[id].inferredOffline;
            delete history[id].inferredOfflineAt;
        }
        saveHistory(history);
    }

    // 详情页自动解析状态与成交价并更新历史
    function tryParseDetailPageAndUpdate() {
        const eidMatch = location.search.match(/eid=([^&]+)/);
        if (!eidMatch) return null;
        const eid = decodeURIComponent(eidMatch[1]).trim();
        const bodyText = (document.body?.innerText || document.body?.textContent || '').replace(/\s+/g, ' ');
        const bodyHtml = document.body?.innerHTML || '';

        // 解析状态：优先用「状态：xxx」格式，否则直接搜索关键词（应对动态加载、不同 DOM 结构）
        let statusText = (bodyText.match(/状态[：:]\s*([^\n\r]+)/) || [])[1] || '';
        let newStatus = null;
        if (/买家取走|已售|已卖出|已成交/.test(statusText) || /买家取走|已售|已卖出|已成交/.test(bodyText)) newStatus = 'sold';
        else if (/已下架|已取回|未上架|卖家已取回|卖家取回/.test(statusText) || /已下架|已取回|未上架|卖家已取回|卖家取回/.test(bodyText)) newStatus = 'offline';
        else if (/在售|出售中/.test(statusText) || /在售|出售中/.test(bodyText)) newStatus = 'alive';

        // 解析成交价：已售时优先找成交价，多种格式兼容
        let priceVal = null;
        const statusIdx = Math.max(bodyText.indexOf('状态'), bodyText.indexOf('买家取走'), bodyText.indexOf('已售'), bodyText.indexOf('已取回'), bodyText.indexOf('卖家已取回'), 0);
        const block = bodyText.substring(statusIdx, statusIdx + 500);
        const patterns = [
            /成交价[：:]\s*[¥]?\s*([\d,]+\.?\d*)/,
            /成交金额[：:]\s*[¥]?\s*([\d,]+\.?\d*)/,
            /(?:价格|售价)[：:]\s*[¥]?\s*([\d,]+\.?\d*)/,
            /[¥￥]\s*([\d,]+\.?\d*)/,
            /(\d{1,6}(?:\.\d{1,2})?)\s*元/
        ];
        for (const re of patterns) {
            const m = block.match(re) || bodyText.match(re);
            if (m && m[1]) {
                const v = parseFloat(m[1].replace(/,/g, ''));
                if (!isNaN(v) && v > 0 && v < 10000000) { priceVal = v; break; }
            }
        }

        const history = getHistory();
        let old = history[eid];
        let updateKey = eid;
        if (!old) {
            const eidBase = eid.split(/[?&#]/)[0];
            for (const [id, item] of Object.entries(history)) {
                if (id === eid || id === eidBase || (item.link && (item.link.includes(eid) || item.link.includes(eidBase)))) {
                    old = item;
                    updateKey = id;
                    break;
                }
            }
        }
        if (!old) return null;

        if (newStatus === 'sold') {
            history[updateKey] = { ...old, manualStatus: 'sold', soldPrice: priceVal != null ? priceVal : old.soldPrice, soldAt: new Date().toLocaleDateString() };
            delete history[updateKey].inferredOffline;
            delete history[updateKey].inferredOfflineAt;
            saveHistory(history);
            return { eid, status: 'sold', price: priceVal };
        }
        if (newStatus === 'offline') {
            history[updateKey] = { ...old, manualStatus: 'offline' };
            delete history[updateKey].soldPrice;
            delete history[updateKey].inferredOffline;
            delete history[updateKey].inferredOfflineAt;
            saveHistory(history);
            return { eid, status: 'offline' };
        }
        if (newStatus === 'alive') {
            history[updateKey] = { ...old, manualStatus: 'alive' };
            delete history[updateKey].soldPrice;
            delete history[updateKey].inferredOffline;
            delete history[updateKey].inferredOfflineAt;
            saveHistory(history);
            return { eid, status: 'alive' };
        }
        return null;
    }

    function exportHistory() {
        const history = getHistory();
        const blob = new Blob([JSON.stringify({
            version: 1,
            exportAt: new Date().toISOString(),
            data: history
        }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `cbg_history_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function importHistory() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = () => {
            const f = input.files?.[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => {
                try {
                    const raw = JSON.parse(r.result);
                    const data = raw.data || raw;
                    if (typeof data !== 'object' || Array.isArray(data)) {
                        showToast('导入失败：文件格式不正确');
                        return;
                    }
                    const history = getHistory();
                    let count = 0;
                    for (const [id, item] of Object.entries(data)) {
                        if (id && item && typeof item === 'object') {
                            history[id] = { ...history[id], ...item };
                            count++;
                        }
                    }
                    saveHistory(history);
                    showToast(`已导入 ${count} 条，当前共 ${Object.keys(history).length} 条`);
                    const modal = document.getElementById('cbg-history-manager-modal');
                    if (modal) modal.dispatchEvent(new CustomEvent('hm-import-done'));
                } catch (e) {
                    showToast('导入失败：' + (e.message || '解析错误'));
                }
            };
            r.readAsText(f, 'UTF-8');
        };
        input.click();
    }

    function showToast(msg, type) {
        const id = 'cbg-toast-' + Date.now();
        const el = document.createElement('div');
        el.id = id;
        el.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;padding:12px 20px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.2);font-size:14px;font-family:Microsoft YaHei,sans-serif;max-width:320px;';
        el.style.background = type === 'success' ? '#28a745' : type === 'info' ? '#17a2b8' : '#333';
        el.style.color = '#fff';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => { const e = document.getElementById(id); if (e) e.remove(); }, 4000);
    }

    // ==========================================
    // 历史管理弹窗（与历史库一样，弹窗展示，方便切回）
    // ==========================================
    function showHistoryManagerModal() {
        const oldModal = document.getElementById('cbg-history-manager-modal');
        if (oldModal) { oldModal.remove(); return; }

        function computeAutoStatus(item, latestBatch, nowTs) {
            const batch = item.scanBatch || 0;
            const raw = item.lastScannedAt || item.lastSeen;
            let lastScanTs = 0;
            if (raw) { const t = Date.parse(raw); if (!isNaN(t)) lastScanTs = t; }
            // 已手动标记则不再显示「同批未刷到」「近期未刷到」等推断状态
            if (item.manualStatus === 'sold' || item.manualStatus === 'alive' || item.manualStatus === 'offline') {
                return { text: '已确认', color: '#999', key: 'confirmed' };
            }
            // 同批未刷到：同页其他都刷到了就它没刷到 → 大概率已售/下架（高置信）
            if (item.inferredOffline) {
                return { text: '同批未刷到', color: '#dc3545', key: 'likely_offline' };
            }
            // 超时未刷到：可能是已售/下架，也可能因未搜该类目（低置信）
            if (lastScanTs > 0 && (nowTs - lastScanTs) > OFFLINE_THRESHOLD_MS) {
                return { text: '近期未刷到', color: '#d9534f', key: 'offline' };
            }
            if (batch && latestBatch) {
                if (batch === latestBatch) return { text: '本批已刷到', color: '#28a745', key: 'current' };
                return { text: '历史批次（需验证）', color: '#f0ad4e', key: 'old' };
            }
            return { text: '状态未知', color: '#999', key: 'unknown' };
        }

        function expandSkillKw(kw) {
            const k = kw.trim().toLowerCase();
            return SKILL_ABBREV[k] || k;
        }
        function itemSearchText(item) {
            const parts = [(item.name || ''), (item.summary || ''), (item.mainAttr || ''), (item.teji || ''), (item.taozhuang || '')];
            if (Array.isArray(item.skills)) parts.push(...item.skills);
            if (Array.isArray(item.attrs)) parts.push(...item.attrs);
            return parts.join(' ').toLowerCase();
        }
        function matchKeyword(item, keyword) {
            const text = itemSearchText(item);
            const link = (item.link || '').toLowerCase();
            const expand = (k) => (SKILL_ABBREV[k] || k).toLowerCase();
            const tokens = keyword.split(/[\s+]+/).filter(Boolean);
            const mustHave = [];
            const mustNotHave = [];
            tokens.forEach(t => {
                if (t.startsWith('-')) mustNotHave.push(expand(t.slice(1)));
                else mustHave.push(expand(t));
            });
            for (const n of mustNotHave) {
                if (text.includes(n) || link.includes(n)) return false;
            }
            for (const h of mustHave) {
                const ok = text.includes(h) || link.includes(h) || (item.name || '').toLowerCase().includes(h);
                if (!ok) return false;
            }
            return true;
        }

        let lastFilteredItems = [];
        function doRender() {
            if (!document.getElementById('hm-tbody')) return;
            const history = getHistory();
            let items = Object.values(history);
            const latestBatch = Math.max(0, ...items.map(i => i.scanBatch || 0));
            const nowTs = Date.now();

            const filterType = document.getElementById('hm-filter-type')?.value || 'all';
            const isPetView = filterType === 'pet' || filterType === 'all';
            const skillWrap = document.getElementById('hm-skill-wrap');
            if (skillWrap) skillWrap.style.display = isPetView ? 'flex' : 'none';
            const presetWrap = document.getElementById('hm-preset-wrap');
            if (presetWrap) {
                if (isPetView) {
                    presetWrap.style.display = 'flex';
                    presetWrap.innerHTML = '<span style="font-size:11px;color:#999">快捷:</span><button type="button" class="hm-preset" data-kw="高连+必杀">高连必杀</button><button type="button" class="hm-preset" data-kw="高连+隐身">高连隐攻</button><button type="button" class="hm-preset" data-kw="高连+偷袭">高连偷袭</button><button type="button" class="hm-preset" data-kw="-神佑">排除神佑</button>';
                } else presetWrap.style.display = 'none';
            }
            const th1 = document.getElementById('hm-th-col1');
            const th2 = document.getElementById('hm-th-col2');
            if (th1 && th2) {
                if (filterType === 'pet') { th1.textContent = '资质/成长'; th2.textContent = '技能数'; }
                else if (filterType === 'equip') { th1.textContent = '等级/主属性'; th2.textContent = '锻造/特技/套装'; }
                else if (filterType === 'lingshi') { th1.textContent = '等级/主属性'; th2.textContent = '精炼/附加'; }
                else if (filterType === 'yupo') { th1.textContent = '摘要'; th2.textContent = '附加属性'; }
                else { th1.textContent = '属性'; th2.textContent = '详情'; }
            }
            const sortEl = document.getElementById('hm-sort');
            if (sortEl) {
                const opt = sortEl.querySelector('option[value="skillNum"]');
                if (opt) opt.style.display = isPetView ? '' : 'none';
            }
            const filterAuto = document.getElementById('hm-filter-auto').value;
            const filterManual = document.getElementById('hm-filter-manual').value;
            const keyword = (document.getElementById('hm-search').value || '').trim();
            const priceMin = parseFloat(document.getElementById('hm-price-min')?.value) || 0;
            const priceMax = parseFloat(document.getElementById('hm-price-max')?.value) || 0;
            const skillMin = parseInt(document.getElementById('hm-skill-min')?.value, 10) || 0;
            const filterServer = document.getElementById('hm-filter-server')?.checked;
            const currentServerId = (location.search.match(/[?&]s=([^&]+)/) || [])[1];
            const sortBy = document.getElementById('hm-sort')?.value || 'lastSeen';

            items = items.filter(item => {
                if (filterType !== 'all') {
                    const t = item.itemType || 'pet';
                    if (t !== filterType) return false;
                }
                if (filterServer && currentServerId && item.serverid != null && String(item.serverid) !== String(currentServerId)) return false;
                const auto = computeAutoStatus(item, latestBatch, nowTs);
                if (filterAuto && filterAuto !== 'all' && auto.key !== filterAuto) return false;
                const m = item.manualStatus || '';
                if (filterManual === 'untreated' && m) return false;
                if (filterManual === 'sold' && m !== 'sold') return false;
                if (filterManual === 'alive' && m !== 'alive') return false;
                if (filterManual === 'offline' && m !== 'offline') return false;
                const p = typeof item.price === 'number' ? item.price : 0;
                if (priceMin > 0 && p < priceMin) return false;
                if (priceMax > 0 && p > priceMax) return false;
                if (skillMin > 0 && (item.itemType || 'pet') === 'pet') {
                    const sk = item.skillNum || (item.skills && item.skills.length) || 0;
                    if (sk < skillMin) return false;
                }
                if (keyword && !matchKeyword(item, keyword)) return false;
                return true;
            });

            if (sortBy === 'priceAsc') items.sort((a, b) => (a.price || 0) - (b.price || 0));
            else if (sortBy === 'priceDesc') items.sort((a, b) => (b.price || 0) - (a.price || 0));
            else if (sortBy === 'firstSeen') items.sort((a, b) => new Date(b.firstSeen || 0) - new Date(a.firstSeen || 0));
            else if (sortBy === 'skillNum') items.sort((a, b) => ((b.skillNum || 0) + (b.skills?.length || 0)) - ((a.skillNum || 0) + (a.skills?.length || 0)));
            else items.sort((a, b) => new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0));

            const tbody = document.getElementById('hm-tbody');
            tbody.innerHTML = items.map((item, i) => {
                const auto = computeAutoStatus(item, latestBatch, nowTs);
                const hasPriceChg = item.prevPrice != null && item.prevPrice !== item.price;
                const priceStr = hasPriceChg ? `¥ ${item.price} <s style="color:#999">(原 ¥ ${item.prevPrice})</s>` : `¥ ${item.price}`;
                const m = item.manualStatus || '';
                const manualText = m === 'sold' ? (item.soldPrice != null ? `已卖掉 ¥${item.soldPrice}` : '已确认卖掉') : m === 'alive' ? '已确认还在' : m === 'offline' ? '已下架' : '未处理';
                const manualColor = m === 'sold' ? '#d9534f' : m === 'alive' ? '#28a745' : m === 'offline' ? '#6c757d' : '#999';
                const esc = s => String(s || '-').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const type = item.itemType || 'pet';
                const typeLabel = type === 'yupo' ? '玉魄' : type === 'lingshi' ? '灵饰' : type === 'equip' ? '装备' : '宠物';
                let col1, col2;
                if (type === 'yupo') {
                    col1 = esc(item.summary || '-');
                    col2 = item.attrs && item.attrs.length ? '<br><span style="font-size:10px;color:#666">' + esc(item.attrs.slice(0,5).join(' ')) + (item.attrs.length > 5 ? '…' : '') + '</span>' : '-';
                } else if (type === 'lingshi') {
                    col1 = `${item.level || '-'}级 ${esc(item.mainAttr || '-')}`;
                    col2 = (item.jinglianLevel != null ? '精炼' + item.jinglianLevel + ' ' : '') + (item.attrs && item.attrs.length ? '<br><span style="font-size:10px;color:#666">' + esc(item.attrs.slice(0,4).join(' ')) + (item.attrs.length > 4 ? '…' : '') + '</span>' : '-');
                } else if (type === 'equip') {
                    col1 = `${item.level || '-'}级 ${esc(item.mainAttr || '-')}`;
                    col2 = (item.gemLevel != null ? item.gemLevel + '锻 ' : '') + (item.holeNum != null ? item.holeNum + '孔 ' : '') + (item.teji ? esc(item.teji) + ' ' : '') + (item.taozhuang ? esc(item.taozhuang) : '') + (item.attrs && item.attrs.length ? '<br><span style="font-size:10px;color:#666">' + esc(item.attrs.slice(0,3).join(' ')) + '</span>' : '');
                } else {
                    col1 = `攻: ${esc(item.gongzi)} / 成: ${esc(item.chengzhang)}`;
                    col2 = `${esc(item.skillNum)} 技能${item.skills && item.skills.length ? '<br><span style="font-size:10px;color:#666">' + esc(item.skills.slice(0,5).join(' ')) + (item.skills.length > 5 ? '…' : '') + '</span>' : ''}`;
                }
                return `
                <tr data-id="${item.id}" style="background:${auto.key === 'likely_offline' ? '#ffe6e6' : auto.key === 'offline' ? '#fff5f5' : ''}">
                    <td>${i + 1}</td>
                    <td><a href="${item.link}" target="_blank" style="font-weight:bold;color:#007bff">${esc(item.name)}</a><span style="font-size:10px;color:#999;margin-left:4px">${typeLabel}</span></td>
                    <td class="col-price">${priceStr}</td>
                    <td>${col1}</td>
                    <td>${col2}</td>
                    <td><span style="color:${auto.color}">${auto.text}</span></td>
                    <td><span style="color:${manualColor}">${manualText}</span></td>
                    <td>
                        <button class="hm-btn hm-btn-sold" data-id="${item.id}">卖掉</button>
                        <button class="hm-btn hm-btn-alive" data-id="${item.id}">还在</button>
                        <button class="hm-btn hm-btn-clear" data-id="${item.id}">清除</button>
                        <a href="${item.link}" target="_blank" class="hm-btn hm-btn-link">查看</a>
                        <button class="hm-btn hm-btn-del" data-id="${item.id}">删除</button>
                    </td>
                </tr>`;
            }).join('') || '<tr><td colspan="8" style="text-align:center;padding:20px">暂无符合条件的数据</td></tr>';

            lastFilteredItems = items;
            document.getElementById('hm-count').textContent = `共 ${items.length} 条`;
            const totalAll = Object.keys(history).length;
            const byType = {};
            Object.values(history).forEach(i => {
                const t = i.itemType || 'pet';
                byType[t] = (byType[t] || 0) + 1;
            });
            const priceArr = Object.values(history).map(i => i.price).filter(p => typeof p === 'number');
            const avgPrice = priceArr.length ? (priceArr.reduce((a, b) => a + b, 0) / priceArr.length).toFixed(0) : '-';
            const statsEl = document.getElementById('hm-stats');
            if (statsEl) statsEl.innerHTML = `统计: 宠物 ${byType.pet || 0} | 装备 ${byType.equip || 0} | 灵饰 ${byType.lingshi || 0} | 玉魄 ${byType.yupo || 0} | 均价 ¥${avgPrice} | 筛选后 ${items.length}/${totalAll}`;
        }

        const modalHtml = `
<div id="cbg-history-manager-modal" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100001;display:flex;justify-content:center;align-items:center;">
    <div style="background:#fff;width:95%;max-width:1100px;height:90%;border-radius:8px;display:flex;flex-direction:column;box-shadow:0 5px 15px rgba(0,0,0,0.3);overflow:hidden;">
        <div class="hm-header" style="background:#333;color:#fff;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
            <h1 style="margin:0;font-size:18px">📦 CBG 历史管理（宠物/玉魄/灵饰/装备）</h1>
            <div style="display:flex;align-items:center;gap:10px">
                <button class="hm-btn" id="hm-export" style="padding:4px 10px;color:#fff;border-color:#fff;background:transparent">导出</button>
                <button class="hm-btn" id="hm-import" style="padding:4px 10px;color:#fff;border-color:#fff;background:transparent">导入</button>
                <button class="hm-btn" id="hm-auto-check" style="padding:4px 10px;background:#f0ad4e;color:#fff;border:none;border-radius:4px;cursor:pointer" title="当前筛选下未确认的项，每30-60秒自动打开详情页">一键请求</button>
                <span id="hm-auto-check-status" style="font-size:11px;color:#ffc107"></span>
                <span id="hm-count">加载中...</span>
                <span id="hm-close" style="margin-left:5px;cursor:pointer;font-size:24px;color:#fff">&times;</span>
            </div>
        </div>
        <div class="hm-filters" style="background:#f8f9fa;padding:12px 20px;display:flex;flex-direction:column;gap:10px;border-bottom:1px solid #eee">
            <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
                <label style="display:flex;align-items:center;gap:6px">类型: <select id="hm-filter-type" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px">
                    <option value="all">全部</option>
                    <option value="pet">宠物</option>
                    <option value="equip">装备</option>
                    <option value="lingshi">灵饰</option>
                    <option value="yupo">玉魄</option>
                </select></label>
                <label style="display:flex;align-items:center;gap:6px" title="藏宝阁为关键词搜索">自动状态: <select id="hm-filter-auto" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px">
                    <option value="all">全部</option>
                    <option value="current">本批已刷到</option>
                    <option value="old">历史批次（需验证）</option>
                    <option value="likely_offline">同批未刷到</option>
                    <option value="offline">近期未刷到</option>
                    <option value="unknown">状态未知</option>
                </select></label>
                <label style="display:flex;align-items:center;gap:6px">手动: <select id="hm-filter-manual" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px">
                    <option value="all">全部</option>
                    <option value="untreated">未处理</option>
                    <option value="sold">已卖掉</option>
                    <option value="alive">还在</option>
                    <option value="offline">已下架</option>
                </select></label>
                <label style="display:flex;align-items:center;gap:6px">价格: <input type="number" id="hm-price-min" placeholder="最低" style="width:70px;padding:6px;border:1px solid #ccc;border-radius:4px"> ~ <input type="number" id="hm-price-max" placeholder="最高" style="width:70px;padding:6px;border:1px solid #ccc;border-radius:4px"></label>
                <label id="hm-skill-wrap" style="display:flex;align-items:center;gap:6px">技能数: <input type="number" id="hm-skill-min" placeholder="≥" style="width:50px;padding:6px;border:1px solid #ccc;border-radius:4px"></label>
                <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="hm-filter-server" title="仅显示当前页面服务器"> 本服</label>
            </div>
            <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                <label style="display:flex;align-items:center;gap:6px">搜索: <input type="text" id="hm-search" placeholder="名称/技能/特技/属性" style="padding:6px 12px;width:220px;border:1px solid #ccc;border-radius:4px"></label>
                <span id="hm-preset-wrap" style="display:flex;align-items:center;gap:6px"></span>
                <label style="display:flex;align-items:center;gap:6px">排序: <select id="hm-sort" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px">
                    <option value="lastSeen">最近刷到</option>
                    <option value="priceAsc">价格升序</option>
                    <option value="priceDesc">价格降序</option>
                    <option value="firstSeen">首次刷到</option>
                    <option value="skillNum">技能数</option>
                </select></label>
                <button class="hm-btn" id="hm-apply" style="padding:4px 12px;border:1px solid #ddd;border-radius:4px;cursor:pointer;background:#fff">应用</button>
            </div>
            <div id="hm-stats" style="font-size:11px;color:#666;padding:4px 0"></div>
        </div>
        <div class="hm-content" style="flex:1;overflow:auto;padding:0">
            <table class="hm-table" style="width:100%;border-collapse:collapse;font-size:12px">
                <thead>
                    <tr><th style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">#</th><th style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">名称</th><th style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">价格</th><th id="hm-th-col1" style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">属性</th><th id="hm-th-col2" style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">详情</th><th style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">自动状态</th><th style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">手动标记</th><th style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">操作</th></tr>
                </thead>
                <tbody id="hm-tbody"></tbody>
            </table>
        </div>
    </div>
</div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById('cbg-history-manager-modal');
        const onHistoryUpdated = () => { if (document.getElementById('cbg-history-manager-modal')) doRender(); refreshDailyStats(); };
        const storageHandler = (e) => { if (e.key === HISTORY_KEY) onHistoryUpdated(); };
        window.addEventListener('storage', storageHandler);
        window.addEventListener('focus', onHistoryUpdated);
        const closeModal = () => {
            modal.remove();
            window.removeEventListener('storage', storageHandler);
            window.removeEventListener('focus', onHistoryUpdated);
        };
        modal.addEventListener('click', (e) => {
            if (e.target.id === 'cbg-history-manager-modal' || e.target.id === 'hm-close') closeModal();
        });
        ['hm-filter-type','hm-filter-auto','hm-filter-manual','hm-filter-server','hm-sort'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', doRender);
        });
        ['hm-price-min','hm-price-max','hm-skill-min'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => { clearTimeout(window._hmT); window._hmT = setTimeout(doRender, 300); });
        });
        document.getElementById('hm-search').addEventListener('input', () => { clearTimeout(window._hmT); window._hmT = setTimeout(doRender, 200); });
        document.getElementById('hm-apply').addEventListener('click', doRender);
        let autoCheckTimer = null;
        let autoCheckQueue = [];
        document.getElementById('hm-auto-check').addEventListener('click', () => {
            const btn = document.getElementById('hm-auto-check');
            const statusEl = document.getElementById('hm-auto-check-status');
            if (autoCheckTimer) {
                clearTimeout(autoCheckTimer);
                autoCheckTimer = null;
                btn.textContent = '一键请求';
                btn.style.background = '#f0ad4e';
                if (statusEl) statusEl.textContent = '已停止';
                return;
            }
            const unconfirmed = lastFilteredItems.filter(i => !i.manualStatus);
            if (unconfirmed.length === 0) {
                showToast('当前筛选下没有未确认的项');
                return;
            }
            autoCheckQueue = unconfirmed.map(i => i.link).filter(Boolean);
            btn.textContent = '停止';
            btn.style.background = '#dc3545';
            const openNext = () => {
                if (autoCheckQueue.length === 0) {
                    autoCheckTimer = null;
                    btn.textContent = '一键请求';
                    btn.style.background = '#f0ad4e';
                    if (statusEl) statusEl.textContent = '已完成';
                    showToast('已全部打开');
                    return;
                }
                const link = autoCheckQueue.shift();
                window.open(link, 'cbg_auto_check');
                if (statusEl) statusEl.textContent = `剩余 ${autoCheckQueue.length} 个，约30-60秒后下一个`;
                const delay = 30000 + Math.random() * 30000;
                autoCheckTimer = setTimeout(openNext, delay);
            };
            openNext();
        });
        document.getElementById('hm-export').addEventListener('click', exportHistory);
        document.getElementById('hm-import').addEventListener('click', importHistory);
        modal.addEventListener('hm-import-done', () => { doRender(); refreshDailyStats(); });
        modal.addEventListener('click', (e) => {
            const t = e.target;
            if (t.classList.contains('hm-preset')) {
                const kw = t.dataset.kw || '';
                const searchEl = document.getElementById('hm-search');
                if (searchEl) { searchEl.value = kw; doRender(); }
                return;
            }
            if (!t.dataset || !t.dataset.id) return;
            if (t.classList.contains('hm-btn-sold')) {
                const priceStr = prompt('请输入成交价（可选，直接回车跳过）', '');
                const soldPrice = priceStr ? parseFloat(priceStr) : null;
                updateItemManualStatus(t.dataset.id, 'sold', isNaN(soldPrice) ? null : soldPrice);
                doRender(); refreshDailyStats();
            }
            else if (t.classList.contains('hm-btn-alive')) { updateItemManualStatus(t.dataset.id, 'alive'); doRender(); refreshDailyStats(); }
            else if (t.classList.contains('hm-btn-clear')) { updateItemManualStatus(t.dataset.id, null); doRender(); refreshDailyStats(); }
            else if (t.classList.contains('hm-btn-del')) { if (confirm('确定删除该条记录？')) { deleteItem(t.dataset.id); doRender(); refreshDailyStats(); } }
        });

        doRender();
    }

    function getDatePart(str) {
        if (!str) return '';
        return String(str).trim().split(/\s/)[0] || '';
    }

    function getStorageUsage() {
        try {
            const raw = localStorage.getItem(HISTORY_KEY) || '{}';
            const bytes = new Blob([raw]).size;
            const limit = 5 * 1024 * 1024; // 5MB 典型限制
            return { bytes, kb: (bytes / 1024).toFixed(1), mb: (bytes / 1024 / 1024).toFixed(2), pct: ((bytes / limit) * 100).toFixed(1) };
        } catch (e) { return { bytes: 0, kb: '0', mb: '0', pct: '0' }; }
    }

    function getDailyStats() {
        const today = new Date().toLocaleDateString();
        const history = getHistory();
        let todayNew = 0, todaySold = 0, todayInferred = 0;
        Object.values(history).forEach(item => {
            const firstDate = item.firstSeenDate || getDatePart(item.firstSeen);
            if (firstDate === today) todayNew++;
            if (item.manualStatus === 'sold' && (item.soldAt || '') === today) todaySold++;
            if (item.inferredOffline && (item.inferredOfflineAt || '') === today) todayInferred++;
        });
        return { todayNew, todaySold, todayInferred, total: Object.keys(history).length };
    }

    function refreshDailyStats() {
        const el = document.getElementById('cbg-daily-stats');
        if (!el) return;
        const s = getDailyStats();
        const u = getStorageUsage();
        el.innerHTML = `今日: 新增 <b>${s.todayNew}</b> | 已售 <b style="color:#d9534f">${s.todaySold}</b> | 同批未刷到 <b>${s.todayInferred}</b> | 共 ${s.total} | 存储 ${u.kb}KB`;
    }

    function createPanel() {
        const div = document.createElement('div');
        div.id = 'cbg-helper-panel';
        div.innerHTML = `
            <h3>🐶 CBG 助手 v3.11.2</h3>
            <div id="cbg-daily-stats" style="font-size:11px;color:#666;padding:4px 0;border-bottom:1px dashed #eee">今日: 加载中...</div>
            <label style="display:flex;align-items:center;gap:6px;margin:8px 0;cursor:pointer">
                <input type="checkbox" id="cbg-auto-scan-toggle" checked>
                <span>自动扫描（进入/翻页时）</span>
            </label>
            <button id="btn-scan" class="cbg-btn btn-scan">🔍 扫描当前页</button>
            <button id="btn-history-mgr" class="cbg-btn btn-view">📑 历史管理</button>
            <button id="btn-clear" class="cbg-btn btn-clear">🗑️ 清空历史</button>

            <h3>💾 筛选方案管理</h3>
            <button id="btn-save-config" class="cbg-btn btn-save">➕ 保存当前筛选</button>
            <button id="btn-reset-filters" class="cbg-btn btn-clear">🧹 重置当前筛选</button>
            <div id="config-list-container" style="max-height: 150px; overflow-y: auto; border: 1px solid #eee; padding: 5px;"></div>

            <button id="btn-keepalive" class="cbg-btn btn-clear" style="margin-bottom:5px">🔄 立即保活</button>
            <div id="cbg-status">准备就绪...</div>
        `;
        document.body.appendChild(div);

        const autoScanToggle = document.getElementById('cbg-auto-scan-toggle');
        autoScanToggle.checked = isAutoScanEnabled();
        autoScanToggle.addEventListener('change', () => {
            setAutoScanEnabled(autoScanToggle.checked);
        });

        document.getElementById('btn-scan').addEventListener('click', () => runScan(false));
        document.getElementById('btn-history-mgr').addEventListener('click', showHistoryManagerModal);
        document.getElementById('btn-clear').addEventListener('click', clearHistory);
        document.getElementById('btn-keepalive').addEventListener('click', () => { doKeepAlivePing(); });
        document.getElementById('btn-save-config').addEventListener('click', saveCurrentConfig);
        document.getElementById('btn-reset-filters').addEventListener('click', resetCurrentFilters);

        document.getElementById('config-list-container').addEventListener('click', (e) => {
            const target = e.target;
            if (target.dataset.action === 'load') {
                loadConfig(target.dataset.name);
            } else if (target.dataset.action === 'del') {
                deleteConfig(target.dataset.name);
            }
        });

        renderConfigList();
        refreshDailyStats();

        // 页面加载完成后启动会话保活
        startKeepAlive();

        // 自动扫描：进入结果页、翻页后自动执行
        setTimeout(tryAutoScan, 500);
        setTimeout(tryAutoScan, 2500);
        if (document.body) startAutoScanObserver();
        else document.addEventListener('DOMContentLoaded', startAutoScanObserver);
    }

    // 详情页：自动解析状态与成交价并更新历史
    const isDetailPage = /\/equip\b/.test(location.pathname) && /eid=/.test(location.search);
    if (isDetailPage) {
        let toastShown = false;
        const run = () => {
            const r = tryParseDetailPageAndUpdate();
            if (r && !toastShown) {
                toastShown = true;
                if (r.status === 'sold') showToast(r.price != null ? `已同步：该商品已卖掉，成交价 ¥${r.price}` : '已同步：该商品已卖掉');
                else if (r.status === 'offline') showToast('已同步：该商品已下架');
                else if (r.status === 'alive') showToast('已同步：该商品仍在售');
            }
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
        else run();
        [2000, 4000, 6000, 8000].forEach(ms => setTimeout(run, ms)); // 动态内容可能延迟加载
        // 监听 DOM 变化，内容可能通过 AJAX 动态插入
        const startObs = () => {
            if (!document.body || toastShown) return;
            let t;
            const obs = new MutationObserver(() => {
                if (toastShown) return;
                clearTimeout(t);
                t = setTimeout(run, 300); // 防抖
            });
            obs.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => obs.disconnect(), 12000);
        };
        if (document.body) startObs();
        else document.addEventListener('DOMContentLoaded', startObs);
        // 详情页增加「同步到历史」按钮，自动失败时可手动触发
        const addSyncBtn = () => {
            if (document.getElementById('cbg-detail-sync-btn')) return;
            const btn = document.createElement('button');
            btn.id = 'cbg-detail-sync-btn';
            btn.textContent = '同步到历史';
            btn.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:9999;padding:8px 14px;border-radius:6px;background:#17a2b8;color:#fff;border:none;cursor:pointer;font-size:13px;font-family:Microsoft YaHei,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.2)';
            btn.onclick = () => {
                const r = tryParseDetailPageAndUpdate();
                if (r) {
                    if (r.status === 'sold') showToast(r.price != null ? `已同步：已卖掉，成交价 ¥${r.price}` : '已同步：已卖掉');
                    else if (r.status === 'offline') showToast('已同步：已下架');
                    else if (r.status === 'alive') showToast('已同步：仍在售');
                } else showToast('未找到历史记录或无法解析状态');
            };
            document.body.appendChild(btn);
        };
        if (document.body) addSyncBtn();
        else document.addEventListener('DOMContentLoaded', addSyncBtn);
    } else {
        setTimeout(createPanel, 1000);
    }
})();
