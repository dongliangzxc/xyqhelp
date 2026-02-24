// ==UserScript==
// @name         CBG 捡漏助手 v3.6 (历史管理页)
// @namespace    http://tampermonkey.net/
// @version      3.6.1
// @description  召唤兽历史记录对比 + 一键保存/读取搜索筛选条件（修复服务器、宝宝、等级按钮不生效问题）。
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
    const HISTORY_KEY = 'cbg_pet_history_v3';
    const CONFIG_KEY = 'cbg_search_configs';
    const HIGHLIGHT_COLOR = '#fff3cd';
    const KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000; // 保活心跳间隔：10 分钟
    const KEEPALIVE_MASTER_KEY = 'cbg_keepalive_master_v1'; // 用于多标签页选主
    const OFFLINE_THRESHOLD_HOURS = 24 * 7; // 一周（168小时）未刷到则标记为"可能已下线" // 多少小时未刷到则标记为“可能已下线”（可按需修改）
    const OFFLINE_THRESHOLD_MS = OFFLINE_THRESHOLD_HOURS * 60 * 60 * 1000;
    const SCAN_BATCH_KEY = 'cbg_scan_batch_v1'; // 当前扫描批次号

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

            // 使用 fetch 向当前页面地址发一个轻量 GET，请求只为刷新会话，不做任何页面跳转
            fetch(window.location.href, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store'
            }).then(() => {
                updateKeepAliveMasterStamp(); // 成功后再续约一次时间戳
                if (statusDiv) {
                    const t = new Date().toLocaleTimeString();
                    statusDiv.innerHTML = `保活中：最近一次心跳 ${t}（每 ${KEEPALIVE_INTERVAL_MS / 60000} 分钟一次，仅当前标签为主时生效）`;
                }
            }).catch(() => {
                if (statusDiv) {
                    const t = new Date().toLocaleTimeString();
                    statusDiv.innerHTML = `保活心跳失败 ${t}，稍后自动重试`;
                }
            });
        };

        // 进入页面先尝试一次心跳，然后按固定间隔继续
        sendPing();
        keepAliveTimer = setInterval(sendPing, KEEPALIVE_INTERVAL_MS);
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
            } catch (e) { console.error("JSON解析失败", e); }
        }

        return {
            id: orderSn,
            name,
            price,
            gongzi,
            chengzhang,
            skillNum: skillNum,
            link,
            lastSeen: new Date().toLocaleString()
        };
    }

    function runScan() {
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

        let newCount = 0;
        let priceChangeCount = 0;

        rows.forEach(row => {
            const data = parsePetRow(row);
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
                const priceArea = row.querySelector('.price') || row.querySelector('.equip-price') || row.querySelector('td:nth-child(3)');
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
                    lastSeen: now,
                    lastPriceChange: now,
                    lastScannedAt: now,  // 上次在搜索结果里刷到的时间
                    scanBatch: currentBatch, // 所属扫描批次
                    prevPrice: null
                };
            } else {
                // 已存在记录
                if (priceChanged) {
                    priceChangeCount++;
                    row.style.backgroundColor = HIGHLIGHT_COLOR;
                    const priceArea = row.querySelector('.price') || row.querySelector('.equip-price') || row.querySelector('td:nth-child(3)');
                    if(priceArea) {
                        const badge = document.createElement('span');
                        badge.className = 'new-tag-badge';
                        badge.innerText = '上次 ¥' + old.price;
                        badge.title = '上次看到的价格';
                        priceArea.appendChild(badge);
                    }

                    history[data.id] = {
                        ...old,
                        ...data,               // 更新名称、资质、链接等基础信息
                        prevPrice: old.price,  // 记录旧价格
                        price: data.price,     // 新价格
                        lastSeen: now,
                        lastPriceChange: now,
                        lastScannedAt: now,    // 本次刷到
                        scanBatch: currentBatch
                    };
                } else {
                    // 价格未变：只更新非价格类字段 + 上次刷到时间
                    history[data.id] = {
                        ...old,
                        gongzi: data.gongzi,
                        chengzhang: data.chengzhang,
                        skillNum: data.skillNum,
                        link: data.link,
                        lastScannedAt: now,    // 本次刷到（可能还在卖）
                        scanBatch: currentBatch
                    };
                }
            }
        });
        saveHistory(history);
        const total = Object.keys(history).length;
        statusDiv.innerHTML = `本次扫描: 新增 <b style="color:red">${newCount}</b> | 价格变动 <b style="color:#d9534f">${priceChangeCount}</b> | 已记录 ${total}`;
    }

    function showHistory() {
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
                    statusText = '可能已下线';
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

    function updateItemManualStatus(id, status) {
        const history = getHistory();
        if (!history[id]) return;
        history[id].manualStatus = status || null;
        saveHistory(history);
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
            // 优先按时间判断：超过阈值未刷到 → 可能已下线
            if (lastScanTs > 0 && (nowTs - lastScanTs) > OFFLINE_THRESHOLD_MS) {
                return { text: '可能已下线', color: '#d9534f', key: 'offline' };
            }
            if (batch && latestBatch) {
                if (batch === latestBatch) return { text: '本批已刷到', color: '#28a745', key: 'current' };
                return { text: '历史批次（需验证）', color: '#f0ad4e', key: 'old' };
            }
            return { text: '状态未知', color: '#999', key: 'unknown' };
        }

        function doRender() {
            const history = getHistory();
            let items = Object.values(history);
            const latestBatch = Math.max(0, ...items.map(i => i.scanBatch || 0));
            const nowTs = Date.now();

            const filterAuto = document.getElementById('hm-filter-auto').value;
            const filterManual = document.getElementById('hm-filter-manual').value;
            const keyword = (document.getElementById('hm-search').value || '').trim().toLowerCase();

            items = items.filter(item => {
                const auto = computeAutoStatus(item, latestBatch, nowTs);
                if (filterAuto && filterAuto !== 'all' && auto.key !== filterAuto) return false;
                const m = item.manualStatus || '';
                if (filterManual === 'untreated' && m) return false;
                if (filterManual === 'sold' && m !== 'sold') return false;
                if (filterManual === 'alive' && m !== 'alive') return false;
                if (keyword && !(item.name || '').toLowerCase().includes(keyword) && !(item.link || '').toLowerCase().includes(keyword)) return false;
                return true;
            });

            items.sort((a, b) => new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0));

            const tbody = document.getElementById('hm-tbody');
            tbody.innerHTML = items.map((item, i) => {
                const auto = computeAutoStatus(item, latestBatch, nowTs);
                const hasPriceChg = item.prevPrice != null && item.prevPrice !== item.price;
                const priceStr = hasPriceChg ? `¥ ${item.price} <s style="color:#999">(原 ¥ ${item.prevPrice})</s>` : `¥ ${item.price}`;
                const m = item.manualStatus || '';
                const manualText = m === 'sold' ? '已确认卖掉' : m === 'alive' ? '已确认还在' : '未处理';
                const manualColor = m === 'sold' ? '#d9534f' : m === 'alive' ? '#28a745' : '#999';
                const esc = s => String(s || '-').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return `
                <tr data-id="${item.id}" style="background:${auto.key === 'offline' ? '#fff5f5' : ''}">
                    <td>${i + 1}</td>
                    <td><a href="${item.link}" target="_blank" style="font-weight:bold;color:#007bff">${esc(item.name)}</a></td>
                    <td class="col-price">${priceStr}</td>
                    <td>攻: ${esc(item.gongzi)} / 成: ${esc(item.chengzhang)}</td>
                    <td>${esc(item.skillNum)} 技能</td>
                    <td><span style="color:${auto.color}">${auto.text}</span></td>
                    <td><span style="color:${manualColor}">${manualText}</span></td>
                    <td>
                        <button class="hm-btn hm-btn-sold" data-id="${item.id}">卖掉</button>
                        <button class="hm-btn hm-btn-alive" data-id="${item.id}">还在</button>
                        <button class="hm-btn hm-btn-clear" data-id="${item.id}">清除</button>
                        <a href="${item.link}" target="_blank" class="hm-btn hm-btn-link">查看</a>
                    </td>
                </tr>`;
            }).join('') || '<tr><td colspan="8" style="text-align:center;padding:20px">暂无符合条件的数据</td></tr>';

            document.getElementById('hm-count').textContent = `共 ${items.length} 条`;
        }

        const modalHtml = `
<div id="cbg-history-manager-modal" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:100001;display:flex;justify-content:center;align-items:center;">
    <div style="background:#fff;width:95%;max-width:1100px;height:90%;border-radius:8px;display:flex;flex-direction:column;box-shadow:0 5px 15px rgba(0,0,0,0.3);overflow:hidden;">
        <div class="hm-header" style="background:#333;color:#fff;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
            <h1 style="margin:0;font-size:18px">📦 CBG 召唤兽历史管理</h1>
            <div>
                <span id="hm-count">加载中...</span>
                <span id="hm-close" style="margin-left:15px;cursor:pointer;font-size:24px;color:#fff">&times;</span>
            </div>
        </div>
        <div class="hm-filters" style="background:#fff;padding:12px 20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #eee">
            <label style="display:flex;align-items:center;gap:6px">自动状态: <select id="hm-filter-auto" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px">
                <option value="all">全部</option>
                <option value="current">本批已刷到</option>
                <option value="old">历史批次（需验证）</option>
                <option value="offline">可能已下线</option>
                <option value="unknown">状态未知</option>
            </select></label>
            <label style="display:flex;align-items:center;gap:6px">手动标记: <select id="hm-filter-manual" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px">
                <option value="all">全部</option>
                <option value="untreated">未处理</option>
                <option value="sold">已确认卖掉</option>
                <option value="alive">已确认还在</option>
            </select></label>
            <label style="display:flex;align-items:center;gap:6px">搜索: <input type="text" id="hm-search" placeholder="名称或链接关键字" style="padding:6px 12px;width:180px;border:1px solid #ccc;border-radius:4px"></label>
            <button class="hm-btn" id="hm-apply" style="padding:4px 12px;border:1px solid #ddd;border-radius:4px;cursor:pointer;background:#fff">应用筛选</button>
        </div>
        <div class="hm-content" style="flex:1;overflow:auto;padding:0">
            <table class="hm-table" style="width:100%;border-collapse:collapse;font-size:12px">
                <thead>
                    <tr><th style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">#</th><th style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">名称</th><th style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">价格</th><th style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">资质/成长</th><th style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">技能数</th><th style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">自动状态</th><th style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">手动标记</th><th style="background:#f2f2f2;padding:10px 8px;text-align:left;position:sticky;top:0">操作</th></tr>
                </thead>
                <tbody id="hm-tbody"></tbody>
            </table>
        </div>
    </div>
</div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById('cbg-history-manager-modal');
        const closeModal = () => modal.remove();
        modal.addEventListener('click', (e) => {
            if (e.target.id === 'cbg-history-manager-modal' || e.target.id === 'hm-close') closeModal();
        });
        document.getElementById('hm-filter-auto').addEventListener('change', doRender);
        document.getElementById('hm-filter-manual').addEventListener('change', doRender);
        document.getElementById('hm-search').addEventListener('input', () => { clearTimeout(window._hmT); window._hmT = setTimeout(doRender, 200); });
        document.getElementById('hm-apply').addEventListener('click', doRender);
        modal.addEventListener('click', (e) => {
            const t = e.target;
            if (!t.dataset || !t.dataset.id) return;
            if (t.classList.contains('hm-btn-sold')) { updateItemManualStatus(t.dataset.id, 'sold'); doRender(); }
            else if (t.classList.contains('hm-btn-alive')) { updateItemManualStatus(t.dataset.id, 'alive'); doRender(); }
            else if (t.classList.contains('hm-btn-clear')) { updateItemManualStatus(t.dataset.id, null); doRender(); }
        });

        doRender();
    }

    function createPanel() {
        const div = document.createElement('div');
        div.id = 'cbg-helper-panel';
        div.innerHTML = `
            <h3>🐶 召唤兽助手 v3.6</h3>
            <button id="btn-scan" class="cbg-btn btn-scan">🔍 扫描当前页</button>
            <button id="btn-view" class="cbg-btn btn-view">📜 查看历史库</button>
            <button id="btn-history-mgr" class="cbg-btn btn-view">📑 历史管理</button>
            <button id="btn-clear" class="cbg-btn btn-clear">🗑️ 清空历史</button>

            <h3>💾 筛选方案管理</h3>
            <button id="btn-save-config" class="cbg-btn btn-save">➕ 保存当前筛选</button>
            <button id="btn-reset-filters" class="cbg-btn btn-clear">🧹 重置当前筛选</button>
            <div id="config-list-container" style="max-height: 150px; overflow-y: auto; border: 1px solid #eee; padding: 5px;"></div>

            <div id="cbg-status">准备就绪...</div>
        `;
        document.body.appendChild(div);

        document.getElementById('btn-scan').addEventListener('click', runScan);
        document.getElementById('btn-view').addEventListener('click', showHistory);
        document.getElementById('btn-history-mgr').addEventListener('click', showHistoryManagerModal);
        document.getElementById('btn-clear').addEventListener('click', clearHistory);
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

        // 页面加载完成后启动会话保活
        startKeepAlive();
    }

    setTimeout(createPanel, 1000);
})();
