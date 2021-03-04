// ==UserScript==
// @name         梦幻 cbg 法伤计算工具
// @namespace    https://github.com/dongliangzxc/xyqhelp 
// @version      0.1
// @description  try to take over the world!
// @author       Jason D
// @match        *://xyq.cbg.163.com/cgi-bin/query.py?*
// @require      http://cdn.bootcss.com/jquery/1.8.3/jquery.min.js
// ==/UserScript==

(function() {
    'use strict';

    // Your code here...
    var zhongzu = localStorage.TM_zhongzu;
    var leixing = localStorage.TM_leixing;
    console.log(zhongzu);
    if(!zhongzu){
        zhongzu = "ren";
        localStorage.TM_zhongzu = "ren";
    }
    if(!leixing){
        leixing = "fa";
        localStorage.TM_is_faxi = "fa";
    }

    var getJueSezhuangbeiStr = document.getElementsByName('equip_kind')[0].labels[0].innerText;
    if(getJueSezhuangbeiStr == "角色装备"){
        $(document).ready(function(){
        var newElement = "<tr>";
            newElement += "<td colspan='10' align='right'>&nbsp;种族：";
            newElement += "<input type='text' class='txt1' size='3' id='txt_zhongzu' value="+zhongzu+">";
            newElement += "&nbsp;&nbsp;是否法系：";
            newElement += "<input type='text' class='txt1' size='6' id='txt_leixing' value="+leixing+">";
            newElement += "&nbsp;&nbsp;&nbsp;&nbsp; <input type='button' id='helperBtn' class='btn1' value='计算'></td>";
            newElement += "</tr>";
            $("tbody")[0].lastChild.after($(newElement)[0]);
            addBtnEvent("helperBtn");
        });
    }

    var objPrev = {'zhongzu':null, 'leixing':null};

    function addBtnEvent(id){
        $("#"+id).bind("click", function(){
            if(isFinish(objPrev) === true){
                alert("计算已经完成");
            }
            else{
                var obj = getInput();
                newPriceList(obj.zhongzu, obj.leixing);
                objPrev = obj;
            }
        });
    }

    function isFinish(obj){
        var temp1 = $("input:text[id='txt_zhongzu']").val();
        var temp2 = $("input:text[id='txt_leixing']").val();
        if(temp1 == obj.zhongzu && temp2 == obj.leixing){
            return true;
        }else{
            return false;
        }
    }

    function getInput(){
        var zhongzu = null;
        var leixing = null;
        var reg = /(^ren$)|(^mo$)|(^xian$)/;
        let temp = $("input:text[id='txt_zhongzu']").val();
        if(temp == ""){
            zhongzu = localStorage.TM_zhongzu;
        }else{
            if(reg.test(temp) == true){
                zhongzu = temp;
                localStorage.TM_zhongzu = zhongzu;
            }else{
                alert("请输入:ren mo xian 随机一个");
                return false;
            }
        }

        temp = $("input:text[id='txt_is_faxi']").val();
        leixing = temp;
        localStorage.TM_leixing = leixing;
        return {
            'zhongzu' : zhongzu,
            'leixing' : leixing
        }
    }

    function newPriceList(zhongzu, leixing){
        var list = document.getElementById('soldList').getElementsByTagName('tr');
        for(var i = 0; i < list.length; i++){
            var price = calPrice(list[i], zhongzu, leixing);
            addCalPrice(list[i], price);
        }
    }

    function addCalPrice(role, price){
        var priceClass = ['p100','p1000','p10000','p100000','p1000000'];
        for (var i=0;i<priceClass.length;i++){
            var oldPrice=role.getElementsByClassName(priceClass[i]);
            if(oldPrice.length > 0 ){
                if(oldPrice[0].parentNode.children[1].nodeName != "SPAN"){ //判断是否存在计算价格
                    let newElement = document.createElement('span');
                    newElement.innerHTML = "【"+price.toFixed(2)+"】";
                    for(let j=4;j>-1;j--){
                        if(price<Math.pow(10,j+2)) newElement.className = priceClass[j];  //可以改变计算价格的显示颜色
                    }
                    oldPrice[0].parentNode.insertBefore(newElement, oldPrice[0].nextSibling); //售价后添加计算值
                    break; //添加价格后立即退出循环
                }
                else {
                    let newElement = document.createElement('span');
                    newElement.innerHTML = "【"+price.toFixed(2)+"】";
                    for(let j=4;j>-1;j--){
                        if(price<Math.pow(10,j+2)) newElement.className = priceClass[j];
                    }
                    oldPrice[0].parentNode.replaceChild(newElement,oldPrice[0].parentNode.children[1]); //售价后添加计算值
                    break;
                }
            }
        }
    }

    function calPrice(role, zhongzu , leixing){
        var shuxingzhuanfashang = {
            体质:0.3,
            敏捷:0,
            耐力:0.2,
            魔力:0.7,
            力量:0.4,
        };
        var equipInfo = role.getElementsByTagName("textarea");
        var equipObj = JSON.parse(equipInfo[0].value);

        //先计算武器
        var type_wuqi = ['剑'];
        var equipType = document.getElementById('s_role_type').selectedOptions[0].outerText;

        var defaultShuxing = 0;

        if(equipObj.gem_level != 0){
            var test = equipObj.desc.match(/镶嵌宝石 (\S+)#r/);
            if(test){
                if(test[1] == '太阳石'){
                    defaultShuxing -= equipObj.gem_level * 2;
                }                
            }
        }
        //计算属性
        for(var i = 0; i < equipObj.main_attrs.length; i++){
            if(equipObj.main_attrs[i][0] == '伤害'){
                defaultShuxing += parseInt(equipObj.main_attrs[i][1])/4;
            }
        }
        if(equipObj.vice_attrs){
            for(i = 0; i < equipObj.vice_attrs.length; i++){
                var temp = equipObj.vice_attrs[i];
                defaultShuxing += parseFloat(shuxingzhuanfashang[temp[0]]) * parseInt(temp[1]);
            }            
        }

        if(equipObj.melt_attrs){
            for(i = 0; i < equipObj.melt_attrs.length; i++){
                temp = equipObj.melt_attrs[i];
                defaultShuxing += parseFloat(shuxingzhuanfashang[temp[0]]) * parseInt(temp[1]);
            }        
        }

        return defaultShuxing;
    }

})();
