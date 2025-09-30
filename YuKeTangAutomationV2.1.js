// ==UserScript==
// @name         雨课堂自动刷课脚本
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  本脚本开源于GitHub，不参与任何盈利以及非法行为，任何人不得非法修改本脚本或用于非法行为。若发现bug请提交至
// @author       Nyarlathotep
// @match        https://fimmuyjs.yuketang.cn/pro/*
// @match        https://www.yuketang.cn/v2/web/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @grant        GM_info
// @run-at       document-start
// ==/UserScript==
//脚本控制台
let console_config={
    maxLogs: 1000,  // 最大日志数量
    autoScroll: true,   // 自动滚动到最新日志
    showTimestamp: true,    // 显示时间戳
    videoPlayRate: 2.0    // 视频播放速率
}
let my_console;

/**
 * 获取课程视频的观看信息
 * @param targetUrl 发送请求的地址
 */
function hijackXMLHTTPRequest(targetUrl) {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    // 重写open方法，用于检测特定的请求URL
    XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
        // 先调用原始方法
        originalOpen.apply(this, arguments);
        // 检查URL是否匹配要拦截的目标
        if (url && url.includes(targetUrl)) {
            // 监听readystatechange事件以获取响应
            this.addEventListener('readystatechange', function () {
                if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
                    try {
                        // 服务器返回的数据在this.responseText中，通常是JSON
                        const responseData = JSON.parse(this.responseText);
                        //  将数据存储到全局变量供页面其他脚本使用
                        window._interceptedVideoLogData = responseData;
                    } catch (e) {
                        console.error('解析响应数据时出错:', e);
                    }
                }
            });
        }
    };

}
hijackXMLHTTPRequest('/video-log/detail/');
/**
 * 劫持雨课堂心跳发送api，利用Web Worker代替雨课堂原有js的定时器精准控制心跳发送，从而绕过浏览器针对后台页面的节流限制
 */
function hijackHeartbeat() {
    // 劫持 setInterval
    const _originalSetInterval = unsafeWindow.setInterval;
    unsafeWindow.setInterval = function(callback, interval, ...args) {
        //根据 interval参数来过滤心跳的定时器，心跳的定时器为5000ms
        if (interval === 5000) {
            console.log("[定时器监听] 发现 setInterval: ", interval, "ms", "回调函数: ", callback);
            unsafeWindow.heartBeat = callback;
            unsafeWindow.heartContext=this;
            unsafeWindow.heartBeatArgs=args;
            return;
        }
        return _originalSetInterval.call(this, callback, interval, ...args);
    };
    //在主线程中创建Web Worker
    const heartbeatBlob = new Blob([`
     const interval = 5000; // 10秒间隔
     setInterval(function() {
         postMessage({ type: 'tick'});
     }, interval);
 `], { type: 'application/javascript' });
    const heartbeatWorker = new Worker(URL.createObjectURL(heartbeatBlob));
    heartbeatWorker.onmessage = function(e) {
        if (e.data.type === 'tick') {
            // 收到Worker的定时信号，触发心跳发送逻辑
            if (unsafeWindow.heartBeat && unsafeWindow.heartContext&&my_console) {
                unsafeWindow.heartBeat.apply(unsafeWindow.heartContext,unsafeWindow.heartBeatArgs);
            }
        }
    };
}
//启动心跳劫持
hijackHeartbeat();
/**
 * css样式注入
 */
GM_addStyle(`
  #console-container {
    position: fixed;
    top: 20px; right: 20px;
    width: 450px;
    background: rgba(0,0,0,0.85);
    color: #fff;
    border: 1px solid #444;
    font-family: monospace;
    z-index: 99999;
    display: block
  }
  .console-header {
    padding: 8px;
    background: #333;
    cursor: move;
  }
  .console-switch {
    float: right;
    background: transparent;
    border: none;
    color: white;
    cursor: pointer;
  }
  .console-body {
    padding: 8px;
    height: 300px;
    overflow: auto;
  }
  .log-entry {
    margin-bottom: 4px;
  }
  .github-link {
    color: #FFA500; /* 这是标准的橙色编码 */
    text-decoration: none;
    position: relative;
    font-weight: 500;
    transition: all 0.3s ease;
    padding: 2px 4px;
    border-radius: 4px;
    background: rgba(255, 165, 0, 0.15);
    word-break: break-all;
  }

  .github-link:hover {
    color: #FFA500; /* 这是标准的橙色编码 */
    background: rgba(255, 165, 0, 0.25);
    text-decoration: underline;
    box-shadow: 0 0 15px rgba(255, 165, 0, 0.4);
  }

  .github-link::after {
    content: "↗";
    margin-left: 5px;
    font-size: 14px;
    display: inline-block;
    transition: transform 0.2s ease;
    }

  .github-link:hover::after {
    transform: translate(3px, -3px);
  }
`);
/**
 * 防止雨课堂切屏检测
 */
function preventScreenCheck() {
    const blackList = new Set(["visibilitychange", "blur", "focus", "pagehide", "pageshow"]); // 需要拦截的事件类型

    // 保存原生方法
    const originalAddEventListener = window.EventTarget.prototype.addEventListener;
    const originalRemoveEventListener = window.EventTarget.prototype.removeEventListener;

    // 劫持 EventTarget.prototype.addEventListener
    window.EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (blackList.has(type)) {
            return undefined; // 直接返回undefined，阻止监听器被添加
        }
        return originalAddEventListener.call(this, type, listener, options);
    };

    // 劫持 EventTarget.prototype.removeEventListener
    window.EventTarget.prototype.removeEventListener = function(type, listener, options) {
        if (blackList.has(type)) {
            return undefined;
        }
        return originalRemoveEventListener.call(this, type, listener, options);
    };

    // 伪造关键属性：让检测代码读取到“永远处于焦点和前台”的状态
    Object.defineProperties(document, {
        'hidden': {
            get: () => false,
            configurable: false,
            enumerable: true
        },
        'visibilityState': {
            get: () => 'visible',
            configurable: false,
            enumerable: true
        },
        'hasFocus': {
            value: () => true,
            configurable: false,
            writable: false
        },
        // 拦截对onvisibilitychange等的赋值
        'onvisibilitychange': {
            get: () => undefined,
            set: () => {},
            configurable: false,
            enumerable: true
        },
        'onblur': {
            get: () => undefined,
            set: () => {},
            configurable: false,
            enumerable: true
        },
        'onfocus': {
            get: () => undefined,
            set: () => {},
            configurable: false,
            enumerable: true
        },
        'onpagehide': {
            get: () => undefined,
            set: () => {},
            configurable: false,
            enumerable: true
        },
        'onpageshow': {
            get: () => undefined,
            set: () => {},
            configurable: false,
            enumerable: true
        }
    });

    // 伪造 window 对象的相关属性
    Object.defineProperties(window, {
        'onblur': {
            get: () => undefined,
            set: () => {},
            configurable: false,
            enumerable: true
        },
        'onfocus': {
            get: () => undefined,
            set: () => {},
            configurable: false,
            enumerable: true
        },
        'onpagehide': {
            get: () => undefined,
            set: () => {},
            configurable: false,
            enumerable: true
        },
        'onpageshow': {
            get: () => undefined,
            set: () => {},
            configurable: false,
            enumerable: true
        }
    });
}
/**
 * 鼠标滑动模拟器，模拟真人鼠标滑动
 */
class MouseSliderSimulator {
    constructor(options = {}) {
        // 合并配置参数
        this.config = {
            interval: options.interval || 3000,          // 滑动间隔（毫秒）
            moveSteps: options.moveSteps || 8,          // 每次滑动的步数
            maxOffset: options.maxOffset || 12,         // 每次滑动的最大偏移量（像素）
            container: options.container || document, // 目标容器选择器
            autoStart: options.autoStart || false        // 是否自动启动
        };

        this.containerElement = null;
        this.moveInterval = null;
        this.lastX = 0;
        this.lastY = 0;
        // 用户活动检测
        this.isUserActive = false;
        // 用户活动检测定时器
        this.userActivityTimer = null;
        // 修复: 提前绑定方法，确保this指向实例
        this._handleUserActivity = this._handleUserActivity.bind(this);

        // 初始化
        this.init();

        // 如果配置为自动启动，则开始滑动
        if (this.config.autoStart) {
            this.start();
        }
    }

    // 初始化方法
    init() {
        this.containerElement = this.config.container;
        if (!this.containerElement) {
            console.error(`目标对象 "${this.config.container}" 为空！`);
            return false;
        }

        // 获取容器边界并设置初始位置
        const containerRect = this.containerElement.getBoundingClientRect();
        this.lastX = containerRect.left + containerRect.width / 2;
        this.lastY = containerRect.top + containerRect.height / 2;

        // 立即移动鼠标到初始位置
        this.triggerMouseMove(this.lastX, this.lastY);
        this._setupUserActivityMonitoring();
        return true;
    }

    // 启动滑动模拟
    start() {
        if (!this.containerElement) {
            if (!this.init()) {
                return false;
            }
        }

        // 清除现有的定时器（防止重复启动）
        this.stop();

        this.moveInterval = setInterval(() => {
            this.slideMouse();
        }, this.config.interval);

        return true;
    }

    // 执行单次滑动
    slideMouse() {
        const containerRect = this.containerElement.getBoundingClientRect();

        // 生成带随机偏移的目标位置
        let targetX = this.lastX + (Math.random() * 2 - 1) * this.config.maxOffset;
        let targetY = this.lastY + (Math.random() * 2 - 1) * this.config.maxOffset;

        // 确保目标位置在容器边界内
        targetX = Math.max(containerRect.left, Math.min(containerRect.left + containerRect.width, targetX));
        targetY = Math.max(containerRect.top, Math.min(containerRect.top + containerRect.height, targetY));

        // 贝塞尔曲线控制点（增加随机轨迹）
        const controlX = this.lastX + (Math.random() - 0.5) * this.config.maxOffset * 2;
        const controlY = this.lastY + (Math.random() - 0.5) * this.config.maxOffset * 2;

        // 分步滑动（沿贝塞尔曲线路径）
        for (let i = 0; i <= this.config.moveSteps; i++) {
            setTimeout(() => {
                const t = i / this.config.moveSteps;
                // 二次贝塞尔曲线计算
                const stepX = Math.round((1-t)**2 * this.lastX + 2*(1-t)*t*controlX + t**2*targetX);
                const stepY = Math.round((1-t)**2 * this.lastY + 2*(1-t)*t*controlY + t**2*targetY);

                this.triggerMouseMove(stepX, stepY);

                // 更新最后位置
                if (i === this.config.moveSteps) {
                    this.lastX = stepX;
                    this.lastY = stepY;
                }
            }, i * 50); // 步间延迟
        }
    }

    // 触发鼠标移动事件
    triggerMouseMove(x, y) {
        const event = new MouseEvent('mousemove', {
            clientX: x,
            clientY: y,
            bubbles: true,
        });
        document.dispatchEvent(event);
    }

    // 停止滑动
    stop() {
        if (this.moveInterval) {
            clearInterval(this.moveInterval);
            this.moveInterval = null;
        }
    }

    // 更新配置
    updateConfig(newConfig) {
        Object.assign(this.config, newConfig);

        // 如果容器选择器有变化，重新初始化
        if (newConfig.container && newConfig.container !== this.config.container) {
            this.init();
        }

        return this;
    }

    // 销毁实例，清理资源
    destroy() {
        this.stop();
        // 移除事件监听器
        document.removeEventListener('mousemove', this._handleUserActivity);
        document.removeEventListener('keydown', this._handleUserActivity);
        document.removeEventListener('click', this._handleUserActivity);
        // 清除用户活动定时器
        if (this.userActivityTimer) {
            clearTimeout(this.userActivityTimer);
        }
        this.containerElement = null;
    }


    // 监听真人操作事件
    _setupUserActivityMonitoring() {
        document.addEventListener('mousemove', this._handleUserActivity);
        document.addEventListener('keydown', this._handleUserActivity);
        document.addEventListener('click', this._handleUserActivity);
        // 可根据需要添加其他事件监听
    }

    // 事件处理函数
    _handleUserActivity(event) {
        // 检查事件是否由用户真实操作触发
        if (event.isTrusted) {
            // 立即停止鼠标模拟
            this.stop();
            // 标记用户为活跃状态
            this.isUserActive = true;
            // 清除现有的定时器（如果存在）
            if (this.userActivityTimer) {
                clearTimeout(this.userActivityTimer);
            }

            // 设置一个新的定时器，3秒后认为用户不再活跃
            this.userActivityTimer = setTimeout(() => {
                this.isUserActive = false;
                this.start();
            }, 3000); // 3秒无操作后重置
        }
    }
}
/**
 * 控制台类的实现
 */
class Console {
    constructor(options = {}) {
        // 默认配置
        this.config = {
            maxLogs: 1000,// 最大日志数量
            autoScroll: true,// 自动滚动到最新日志
            showTimestamp: true,// 显示时间戳
            videoPlayRate: 2.0,// 视频播放速率
            ...options// 用户自定义配置覆盖默认配置
        };

        // 创建控制台容器
        this.container = document.createElement('div');
        this.container.id = 'console-container';

        // 创建标题栏
        this.header = document.createElement('div');
        this.header.className = 'console-header';
        this.header.innerHTML = `
                    <span class="console-title">Console</span>
                    <button class="console-switch">收起</button>
                `;

        // 创建日志区域
        this.logContainer = document.createElement('div');
        this.logContainer.className = 'console-body';

        // 组装元素
        this.container.appendChild(this.header);
        this.container.appendChild(this.logContainer);
        document.body.appendChild(this.container);

        //给头部的console-close按钮添加点击隐藏事件
        this.header.querySelector('.console-switch').addEventListener('click', () => this.switch());
        // 给控制台容器添加拖拽功能
        this._setupDrag(this.header);

        // 日志存储
        this.logs = [];
    }

    // 核心日志方法
    log(...args) {
        this._addEntry('log', 'INFO', '#d4d4d4', ...args);
    }

    warn(...args) {
        this._addEntry('warn', 'WARN', '#d7ba7d', ...args);
    }

    error(...args) {
        this._addEntry('error', 'ERROR', '#f44747', ...args);
    }

    clear() {
        this.logContainer.innerHTML = '';
        this.logs = [];
    }

    show() {
        this.logContainer.style.height = '300px';
        this.header.querySelector('.console-switch').innerText = "收起"
    }

    hide() {
        this.logContainer.style.height = '0px';
        this.header.querySelector('.console-switch').innerText = "展开"
    }

    switch() {
        if (this.logContainer.style.height === "0px") {
            this.show()
        } else {
            this.hide()
        }
    }

    // 内部实现
    _addEntry(type, label, color, ...messages) {
        // 创建日志条目
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;

        // 如果设置中显示时间戳，则添加时间戳元素
        if (this.config.showTimestamp) {
            const timeSpan = document.createElement('span');
            timeSpan.className = 'log-time';
            timeSpan.textContent = new Date().toLocaleTimeString();
            logEntry.appendChild(timeSpan);
        }

        // 添加日志标签
        const labelSpan = document.createElement('span');
        labelSpan.textContent = `[${label}] `;
        labelSpan.style.color = color;
        logEntry.appendChild(labelSpan);

        // 处理消息内容
        messages.forEach(msg => {
            const contentSpan = document.createElement('span');

            if (msg.nodeType===1){
                contentSpan.appendChild(msg);
            } else if(typeof msg === 'object'){
                contentSpan.textContent = JSON.stringify(msg, null, 2);
            } else {
                contentSpan.textContent = msg;
            }
            contentSpan.style.color = color;
            logEntry.appendChild(contentSpan);
            logEntry.appendChild(document.createTextNode(' '));
        });

        // 添加到容器
        this.logContainer.appendChild(logEntry);
        this.logs.push(logEntry);

        // 自动滚动
        if (this.config.autoScroll) {
            this.logContainer.scrollTop = this.logContainer.scrollHeight;
        }

        // 日志数量限制
        if (this.logs.length > this.config.maxLogs) {
            this.logs.shift().remove();
        }
    }

    // 拖拽功能实现
    _setupDrag(header) {
        let isDragging = false;
        let offsetX, offsetY;
        // 鼠标按下事件，开始拖拽
        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            offsetX = e.clientX - this.container.getBoundingClientRect().left;
            offsetY = e.clientY - this.container.getBoundingClientRect().top;
            this.container.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            this.container.style.left = (e.clientX - offsetX) + 'px';
            this.container.style.top = (e.clientY - offsetY) + 'px';
            this.container.style.right = 'unset';
            this.container.style.bottom = 'unset';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            this.container.style.cursor = 'default';
        });
    }
}
/**
 * 模拟人类点击事件，欺骗某些对事件检测严格的元素
 * @param element
 */
const simulateHumanClick = (element) => {
    const rect = element.getBoundingClientRect();
    const events = [
        {type: 'mousemove', x: rect.left-10, y: rect.top-10},
        {type: 'mousemove', x: rect.left+5, y: rect.top+5},
        {type: 'mousedown'},
        {type: 'mouseup'},
        {type: 'click'}
    ];

    events.forEach(e => {
        const event = new MouseEvent(e.type, {
            bubbles: true,
            clientX: e.x || rect.left + rect.width/2,
            clientY: e.y || rect.top + rect.height/2
        });
        element.dispatchEvent(event);
    });
};
/**
 * dom元素查找的可靠实现
 * @param selector 选择器字符串
 * @param targetContainer 可选，默认为document。指定在哪个容器内查找元素
 * @param timeout 可选，默认为500ms。dom树变动的最长等待时间
 * @param baseDelay 可选，默认为10ms。每次重试的延迟时间，指数增长
 * @param maxRetries 可选，默认为5。最大重试次数
 * @returns {Promise<unknown>} Promise对象，解析为找到的元素或错误信息
 */
function waitForElement(selector, targetContainer = document, baseDelay = 10, maxRetries = 10) {
    return new Promise((resolve, reject) => {
        let retryCount = 0;

        function attempt() {
            //检查
            const element = targetContainer.querySelector(selector);
            if (element) {
                return resolve(element);
            }
            retryCount++;
            if (retryCount <= maxRetries) {
                // 等待指数退避时间后，进行下一次attempt
                StrictSetTimeOut(attempt, baseDelay * Math.pow(2, retryCount - 1));
            } else {
                reject(new Error(`查找元素${selector}失败，重试次数已达上限,请检查网络连接。`));
            }
        }
        // 开始第一次尝试
        attempt();
    });
}
function scrollForData(container){
    return new Promise((resolve, reject)=>{
        // 创建真实的滚动事件
        const scrollEvent = new Event('scroll', {
            bubbles: true,
            cancelable: true
        });
        container.dispatchEvent(scrollEvent);
        // 同时执行滚动操作
        container.scrollTop = container.scrollHeight;
        let worker=StrictSetInterval(()=>{
            let end=container.querySelector(".studentCard>.end");
            if(end!=null){
                worker.terminate();
                StrictSetTimeOut(()=>{
                    return resolve();
                },2000);
            }else{
                // 创建真实的滚动事件
                const scrollEvent = new Event('scroll', {
                    bubbles: true,
                    cancelable: true
                });
                container.dispatchEvent(scrollEvent);
                // 同时执行滚动操作
                container.scrollTop = container.scrollHeight;
            }
        },100)
    })
}
/**
 * 突破浏览器的节流限制，利用WebWorker设置一个严格计时器
 * @param {number} delay - 定时器延迟时间（毫秒）
 * @param {Function} callback - 定时结束后执行的回调函数
 * @returns {Worker} 返回Web Worker实例，可用于提前终止定时器
 */
function StrictSetTimeOut(callback, delay) {
    // 创建Worker的Blob对象，包含定时逻辑
    const workerBlob = new Blob([`
        self.onmessage = function(e) {
            const delayTime = e.data;
            setTimeout(function() {
                self.postMessage({ type: 'timerComplete' });
            }, delayTime);
        };
    `], { type: 'application/javascript' });

    // 创建Web Worker
    const worker = new Worker(URL.createObjectURL(workerBlob));
    //主线程接收WebWorker定时消息
    worker.onmessage = function(e) {
        if (e.data.type === 'timerComplete') {
            callback();
            worker.terminate(); // 执行完成后自动终止Worker
        }
    };
    // 发送延迟时间参数，启动定时器
    worker.postMessage(delay);
    return worker;
}
function StrictSetInterval(callback,interval){
    const workerBlob = new Blob([`
        self.onmessage = function(e) {
            const interval = e.data;
            setInterval(function() {
                self.postMessage({ type: 'trigger' });
            }, interval);
        };
    `], { type: 'application/javascript' });
    // 创建Web Worker
    const worker = new Worker(URL.createObjectURL(workerBlob));
    //主线程接收WebWorker定时消息
    worker.onmessage = function(e) {
        if (e.data.type === 'trigger') {
            callback();
        }
    };
    worker.postMessage(interval);
    return worker;
}
/**
 * 页面为选择课程主页时执行的逻辑
 */
function selectLessonPageLogic(){
    my_console.log("当前页面为课程选择页面,正在查找所有的课程...");
    let app = document.getElementById("app");
    waitForElement(".grid",app).then(element=>{
        setTimeout(()=>{
            let lessonsName=element.querySelectorAll("h1");
            my_console.log("查找结果：");
            let names=[];
            lessonsName.forEach(node=>{
                names.push(node.textContent.trim());
            })
            my_console.log(names);
            my_console.warn("请选择对应的课程进行学习，脚本会自动开始刷课");
        },1000);
    }).catch(err=>{
        my_console.error(err);
    });
}
/**
 * 课程中选择学习内容才处理逻辑
 */
function selectLessonItemPageLogic(){
    my_console.log("当前页面为课程页面,正在寻找第一个未完成的课程...");
    let app = document.getElementById("app");
    waitForElement(".main-box",app).then((element)=>{
        setTimeout(()=>{
            let states= element.querySelectorAll(".chapter-list>.content>.el-tooltip>.progress-time>.progress-wrap>.item");
            let i;
            for(i =0;i<states.length;i++){
                if(states[i].textContent!=="已完成"){
                    my_console.log("已找到，开始学习...");
                    states[i].click();
                    break;
                }
            }
            if(i===states.length){
                my_console.log("全部课程已经学完！");
            }
        },1000);
    }).catch(err=>{
        my_console.error(err);
    });
}
function selectLessonItemPageLogicV2(){
    my_console.log("当前页面为课程页面,正在寻找第一个未完成的课程...");
    let app = document.getElementById("app");
    async function getLession(logsList){
        let sections=logsList.querySelectorAll(`
        .studentCard > .activity-box > .content-box 
        section[data-v-3364229e][data-v-43c8f7eb]
        `);
        let processedSections=[];
        for (let i=0;i<sections.length;i++){
            let displaySpan=sections[i].querySelector("div.sub-info>span.gray>span.blue");
            if(displaySpan!=null){
                displaySpan.click();
                let hiddenSection=sections[i].nextElementSibling;
                await waitForElement(".chapter",hiddenSection).then((element)=>{
                    console.log("找到了章节");
                    hiddenSection.querySelectorAll(`.chapter section[data-v-37b23e93][data-v-15dbc820]`).forEach(
                        (chapter)=>{
                            processedSections.push(chapter);
                        }
                    )
                })
            }else{
                processedSections.push(sections[i]);
            }
            console.log("循环一次");
        }
        console.log(processedSections)
        return processedSections;
    }
    waitForElement("div#pane--1>.logs-list",app).then((element)=>{
        StrictSetTimeOut(()=>{
            let container=document.querySelector(".viewContainer");
            scrollForData(container).then(async ()=>{
                let sections= await getLession(element);
                console.log("选择完成");
                let filteredSections = Array.from(sections).filter(section => {
                    let tagElement=section.querySelector("use");
                    const xlinkHrefValue =tagElement.getAttribute('xlink:href');
                    let stateElement=section.querySelector(".aside>span");
                    const state=stateElement.textContent;
                    return xlinkHrefValue==="#icon-shipin"&&state!=="已完成";
                })
                if(filteredSections.length==0){
                    my_console.log("全部课程已经学完！");
                }else{
                   filteredSections[0].click();
                }

            })
        },1000);
    })
}
/**
 * 自动播放视频
 */
function autoPlayVideo(){
    GM_addStyle(
        `.el-dialog__wrapper{
        display:none !important;
    }`
    )
    /**
     * 对视频进行区间播放，跳过已经播放过的视频
     */
    function intervalPlay(){
        let watchedInterval=window._interceptedVideoLogData.data.heartbeat.result;
        my_console.log("已观看区间："+JSON.stringify(watchedInterval));
        let currentInterval=0;
        let end=currentInterval<watchedInterval.length?watchedInterval[currentInterval]['s']:videoElement.duration;
        videoElement.currentTime=0;
        //在主线程中创建Web Worker
        const videoFlushBlob = new Blob([`
         const interval = 10000; // 10秒间隔
         setInterval(function() {
            self.postMessage({ type: 'check'});
         }, interval);
 `      ], { type: 'application/javascript' });
        videoElement.play();
        const videoFlushWorker = new Worker(URL.createObjectURL(videoFlushBlob));
        videoFlushWorker.postMessage({type:'launch'});
        let recordTime=videoElement.currentTime;
        let stopCount=0;
        videoFlushWorker.onmessage = function(e) {
            if (e.data.type === 'check') {
                my_console.log("当前视频时间:"+videoElement.currentTime);
                if(recordTime==videoElement.currentTime){
                    stopCount++;
                    my_console.log(`检测到视频进度未变动：重试第${stopCount}次`);
                    if(stopCount>5){
                        location.reload();
                    }
                }
                recordTime=videoElement.currentTime;
                // 收到Worker的定时信号
                if(videoElement.currentTime<=videoElement.duration&&videoElement.currentTime>=end){
                    my_console.log("跳过已经观看过的区间:"+watchedInterval[currentInterval]['s']+"-"+watchedInterval[currentInterval]['e']);
                    videoElement.currentTime=watchedInterval[currentInterval]['e'];
                    currentInterval++;
                    end=currentInterval<watchedInterval.length?watchedInterval[currentInterval]['s']:videoElement.duration;
                }
            }
        };
    }
    my_console.log("当前页面为视频播放页面,正在自动播放视频...");
    let videoElement;
    //获取雨课堂的最高层静态div
    let app=document.getElementById('app');
    let callback=()=>{
        //如果该视频已经是完成状态了，则直接跳转下一个
        waitForElement(".title-fr>.progress-wrap>.item>.text",app).then(finish=>{
            if(finish.innerText==="完成度：100%"){
                my_console.log("当前课程已经学完，即将跳转至下一个课程...");
                let nextButton=document.querySelector('span.btn-next.ml20.pointer');
                simulateHumanClick(nextButton);
            }
        }).catch(err=>{
            location.reload();
        });
        //打印当前课程名称
        waitForElement('.title-fl > span',app).then(title=>{
            my_console.log("当前课程："+title.innerText);
        }).catch(err=>{
            my_console.error("课程名出错："+err);
            location.reload();
        });
        //选择视频播放速率
        let rateListPromise=waitForElement('.xt_video_player_common_list',app);
        let rateButtonPromise=waitForElement('xt-speedbutton',app);
        //两个dom元素必须都要获取到
        Promise.all([rateListPromise,rateButtonPromise]).then(([rateList,rateButton])=>{
            //如果用户设定的速率并不在原有速率列表中，将速率列表中的第一个速率改成对应速率
            if (![0.5, 1.0, 1.25, 1.5, 2.0].includes(console_config.videoPlayRate)){
                let newVideoPlayRate = rateList.childNodes[0];
                newVideoPlayRate.setAttribute('data-speed', console_config.videoPlayRate);
                newVideoPlayRate.setAttribute('keyt',console_config.videoPlayRate);
                newVideoPlayRate.innerText=console_config.videoPlayRate.toFixed(2)+"x";
            }
            //鼠标移动到速率选择上
            let rateButtonRect = rateButton.getBoundingClientRect();
            const mouseMove = new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                clientX: (rateButtonRect.left+rateButtonRect.right)/2, // 相对于视口的X坐标
                clientY: (rateButtonRect.top+rateButtonRect.bottom)/2  // 相对于视口的Y坐标
            });
            rateButton.dispatchEvent(mouseMove);
            //选择速率的第一个
            rateList.children[0].click();
            //静音播放视频
            waitForElement('xt-controls > xt-inner > xt-volumebutton > xt-icon',app).then((mute=>{
                //静音播放视频
                mute.click();
                intervalPlay();
            })).catch(err=>{
                my_console.error("静音："+err);
                location.reload();
            })
        }).catch(err=>{
            my_console.error("速率调整："+err);
            location.reload();
        })
    }
    //寻找视频元素，并对其进行操作
    waitForElement("video.xt_video_player",app).then(element=>{
        videoElement=element;
        //触发获取视频详情api
        waitForElement('.log-detail').then(element=>{
            element.click();
            waitForElement('.v-modal').then(element => {
                element.remove();
            })
        })
        //监听视频暂停事件，重新播放视频
        videoElement.addEventListener("pause",()=>{
            if (videoElement.currentTime <= videoElement.duration - 1){
                videoElement.play();
            }
        });
        //监听视频播放完毕事件，自动跳转至下一个视频
        videoElement.addEventListener("ended",()=>{
            let nextButton=document.querySelector('span.btn-next.ml20.pointer');
            if(nextButton){
                my_console.log("当前视频播放完毕，3s后播放下一个视频...");
                const nextVideoTimer = new Blob([`
                    const interval = 3000; // 3秒间隔
                    setTimeout(function() {
                    self.postMessage({ type: 'next'});
                    }, interval);
 `              ], { type: 'application/javascript' });
                const nextVideoWorker = new Worker(URL.createObjectURL(nextVideoTimer));
                nextVideoWorker.onmessage = function(e) {
                    if (e.data.type === 'next') {
                        simulateHumanClick(nextButton);
                    }
                };
            }else{
                my_console.log("最后一个视频播放完毕，本课程已经结束!");
            }
        });
        let mouseSliderConfig={
            container: app,
            autoStart: true
        }
        window.mouseSliderSimulator = new MouseSliderSimulator(mouseSliderConfig);
        const callbackTimer = new Blob([`
                    const interval = 1000; // 3秒间隔
                    setTimeout(function() {
                    self.postMessage({ type: 'callback'});
                    }, interval);
 `              ], { type: 'application/javascript' });
        const callbackWorker = new Worker(URL.createObjectURL(callbackTimer));
        callbackWorker.onmessage = function(e) {
            if (e.data.type === 'callback') {
                callback();
            }
        };
    }).catch(err=>{
        my_console.error("寻找视频元素"+err);
        location.reload();
    });
}
function autoPlayVideoV2(){
    GM_addStyle(
        `.el-dialog__wrapper{
        display:none !important;
    }`
    )
    /**
     * 对视频进行区间播放，跳过已经播放过的视频
     */
    function intervalPlay(){
        let watchedInterval=window._interceptedVideoLogData.data.heartbeat.result;
        my_console.log("已观看区间："+JSON.stringify(watchedInterval));
        let currentInterval=0;
        let end=currentInterval<watchedInterval.length?watchedInterval[currentInterval]['s']:videoElement.duration;
        videoElement.currentTime=0;
        //在主线程中创建Web Worker
        const videoFlushBlob = new Blob([`
         const interval = 10000; // 10秒间隔
         setInterval(function() {
            self.postMessage({ type: 'check'});
         }, interval);
 `      ], { type: 'application/javascript' });
        videoElement.play();
        const videoFlushWorker = new Worker(URL.createObjectURL(videoFlushBlob));
        videoFlushWorker.postMessage({type:'launch'});
        let recordTime=videoElement.currentTime;
        let stopCount=0;
        videoFlushWorker.onmessage = function(e) {
            if (e.data.type === 'check') {
                my_console.log("当前视频时间:"+videoElement.currentTime);
                if(videoElement.currentTime<=recordTime){
                    stopCount++;
                    my_console.log(`检测到视频进度未变动：重试第${stopCount}次`);
                    if(stopCount>5){
                        location.reload();
                    }
                }
                recordTime=videoElement.currentTime;
                // 收到Worker的定时信号
                if(videoElement.currentTime<=videoElement.duration&&videoElement.currentTime>=end){
                    my_console.log("跳过已经观看过的区间:"+watchedInterval[currentInterval]['s']+"-"+watchedInterval[currentInterval]['e']);
                    videoElement.currentTime=watchedInterval[currentInterval]['e'];
                    currentInterval++;
                    end=currentInterval<watchedInterval.length?watchedInterval[currentInterval]['s']:videoElement.duration;
                }
            }
        };
    }
    my_console.log("当前页面为视频播放页面,正在自动播放视频...");
    let videoElement;
    //获取雨课堂的最高层静态div
    let app=document.getElementById('app');
    let callback=()=>{
        //打印当前课程名称
        waitForElement('.title-fl > span',app).then(title=>{
            my_console.log("当前课程："+title.innerText);
        }).catch(err=>{
            my_console.error("课程名出错："+err);
            location.reload();
        });
        //选择视频播放速率
        let rateListPromise=waitForElement('.xt_video_player_common_list',app);
        let rateButtonPromise=waitForElement('xt-speedbutton',app);
        //两个dom元素必须都要获取到
        Promise.all([rateListPromise,rateButtonPromise]).then(([rateList,rateButton])=>{
            //如果用户设定的速率并不在原有速率列表中，将速率列表中的第一个速率改成对应速率
            if (![0.5, 1.0, 1.25, 1.5, 2.0].includes(console_config.videoPlayRate)){
                let newVideoPlayRate = rateList.childNodes[0];
                newVideoPlayRate.setAttribute('data-speed', console_config.videoPlayRate);
                newVideoPlayRate.setAttribute('keyt',console_config.videoPlayRate);
                newVideoPlayRate.innerText=console_config.videoPlayRate.toFixed(2)+"x";
            }
            //鼠标移动到速率选择上
            let rateButtonRect = rateButton.getBoundingClientRect();
            const mouseMove = new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                clientX: (rateButtonRect.left+rateButtonRect.right)/2, // 相对于视口的X坐标
                clientY: (rateButtonRect.top+rateButtonRect.bottom)/2  // 相对于视口的Y坐标
            });
            rateButton.dispatchEvent(mouseMove);
            //选择速率的第一个
            rateList.children[0].click();
            //静音播放视频
            waitForElement('xt-controls > xt-inner > xt-volumebutton > xt-icon',app).then((mute=>{
                //静音播放视频
                mute.click();
                intervalPlay();
            })).catch(err=>{
                my_console.error("静音："+err);
                location.reload();
            })
        }).catch(err=>{
            my_console.error("速率调整："+err);
            location.reload();
        })
    }
    //寻找视频元素，并对其进行操作
    waitForElement("video.xt_video_player",app).then(element=>{
        videoElement=element;
        //触发获取视频详情api
        waitForElement('.log-detail').then(element=>{
            element.click();
            waitForElement('.v-modal').then(element => {
                element.remove();
            })
        })
        //监听视频暂停事件，重新播放视频
        videoElement.addEventListener("pause",()=>{
            if (videoElement.currentTime <= videoElement.duration - 1){
                videoElement.play();
            }
        });
        //监听视频播放完毕事件，自动跳转至下一个视频
        videoElement.addEventListener("ended",()=>{
                my_console.log("当前视频播放完毕，3s后播放下一个视频...");
                const nextVideoTimer = new Blob([`
                    const interval = 3000; // 3秒间隔
                    setTimeout(function() {
                    self.postMessage({ type: 'next'});
                    }, interval);
 `              ], { type: 'application/javascript' });
                const nextVideoWorker = new Worker(URL.createObjectURL(nextVideoTimer));
                nextVideoWorker.onmessage = function(e) {
                    if (e.data.type === 'next') {
                        let lastPage=app.querySelector(".icon-shangyigex");
                        lastPage.click();
                    }
                };
        });
        let mouseSliderConfig={
            container: app,
            autoStart: true
        }
        window.mouseSliderSimulator = new MouseSliderSimulator(mouseSliderConfig);
        const callbackTimer = new Blob([`
                    const interval = 1000; // 3秒间隔
                    setTimeout(function() {
                    self.postMessage({ type: 'callback'});
                    }, interval);
 `              ], { type: 'application/javascript' });
        const callbackWorker = new Worker(URL.createObjectURL(callbackTimer));
        callbackWorker.onmessage = function(e) {
            if (e.data.type === 'callback') {
                callback();
            }
        };
    }).catch(err=>{
        my_console.error("寻找视频元素"+err);
        location.reload();
    });
}
//当路由变动时，所需要进行的操作
function onRouteChange(path) {
    console.log(window.location.href);
    my_console.clear();
    if(window.mouseSliderSimulator){
        window.mouseSliderSimulator.destroy();
    }
    location.reload();
}
/**
 * 劫持跳转页面的行为，重新匹配目的地址的操作逻辑
 */
function hackHistoryApi(){
    /**
     * History API
     *  包含 pushState()和 replaceState()方法，用于主动操作浏览器历史记录栈：
     *  pushState()：新增历史记录条目（URL 变化但页面不刷新）
     *  replaceState()：替换当前历史记录条目（常用于静默更新 URL）
     *  本质是开发者主动控制路由的工具。
     * popstate事件
     * 属于被动监听机制，在用户触发浏览器行为（如点击前进/后退按钮）或调用 history.back()/forward()时自动触发。
     * 本质是对用户导航行为的响应。
     */
        //劫持原有的History API
    const _originalPushState = history.pushState;
    const _originalReplaceState = history.replaceState;
    //重写History API.增加路由改变时的行为逻辑
    history.pushState = function (state, title, url) {
        //执行原始的 pushState 方法
        const result = _originalPushState.apply(this, arguments);
        onRouteChange(url)
        console.log("新增历史记录条目");
        return result;
    };
    history.replaceState = function (state, title, url) {
        // 执行原始的 replaceState 方法
        const result = _originalReplaceState.apply(this, arguments);
        //onRouteChange(url);
        console.log("替换历史记录条目");
        return result;
    };
    //修复：以上的History Api劫持不能作用于浏览器的前进/后退,因此监听 popstate 事件（右键前进/后退触发）
    window.addEventListener('popstate', () => {
        onRouteChange(window.location.pathname);
        console.log("前进/后退触发");
    });
}
//正则表达式匹配规则
class Regex {
    static videoPathRegex = /^\/pro\/[^\/]+(\/[^\/]+)*\/video\/[^\/]+$/;
    static lessonPathRegex = /^\/pro(\/.*)?\/studycontent$/;
    static host = "/pro/courselist";
    static hostV2 = "/v2/web/index";
    static lessonPathRegexV2 = /^\/v2\/web\/studentLog[^\s]*/;
    static videoPathRegexV2 = /^\/v2\/web\/xcloud\/video-student[^\s]*/;
}
//网页不同路由的处理逻辑匹配
function start(currentPath){
    //页面匹配处理逻辑:查找表
    const pathHandler=[
        { condition: path => path === Regex.host || path===Regex.hostV2, action: selectLessonPageLogic },
        { condition: path => Regex.lessonPathRegex.test(path), action: selectLessonItemPageLogic },
        { condition: path => Regex.videoPathRegex.test(path), action: autoPlayVideo },
        { condition: path => Regex.lessonPathRegexV2.test(path), action: selectLessonItemPageLogicV2 },
        { condition: path => Regex.videoPathRegexV2.test(path), action: autoPlayVideoV2 },
        { condition: path => true, action: ()=>{my_console.error("未知路径，暂未开发对应的功能，请进入学习空间")}}
    ]
    //页面匹配处理
    my_console.log("当前路径："+currentPath);
    for(const{condition,action} of pathHandler){
        if(condition(currentPath)){
            action();
            break;
        }
    }
}

/**
 * 主程序
 */
(function(){
    'use strict';
    preventScreenCheck();
    hackHistoryApi();
    window.addEventListener('DOMContentLoaded', function() {
        my_console=new Console(console_config);
        let welcome=`欢迎使用${GM_info.script.name}，当前版本为${GM_info.script.version}`
        let gitHubUrl = document.createElement("a");
        gitHubUrl.href = "https://github.com/Nyarlathotep0113/YuKeTangAutomation";
        gitHubUrl.innerText = "https://github.com/Nyarlathotep0113/YuKeTangAutomation";
        gitHubUrl.className = "github-link";
        my_console.log(welcome);
        my_console.warn(GM_info.script.description,gitHubUrl,`by ${GM_info.script.author}`);
        const currentPath = window.location.pathname;
        start(currentPath);
    });
})()	
