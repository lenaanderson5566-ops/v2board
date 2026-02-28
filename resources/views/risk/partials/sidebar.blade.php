<aside class="sidebar">
        
        <div class="menu-section" data-group="risk">
            <div class="menu-group-title">风控中心</div>
            <div class="menu-list">
                <button class="menu-btn" data-section="risk" onclick="fetchRiskSettings(this)">风控参数配置</button>
                <button class="menu-btn" data-section="risk" onclick="fetchRules(this)">风控规则配置</button>
                <button class="menu-btn" data-section="risk" onclick="fetchBlacklists(this)">风控黑名单</button>
                <button class="menu-btn" data-section="risk" onclick="fetchOnlineUsers(this)">实时在线IP</button>
                <button class="menu-btn" data-section="risk" onclick="fetchUserUsage(this)">用户画像总览</button>
            </div>
        </div>

        <div class="menu-section" data-group="client">
            <div class="menu-group-title">客户端中心</div>
            <div class="menu-list">
                <button class="menu-btn" data-section="client" onclick="fetchClientStrategies(this)">客户端策略管理</button>
            </div>
        </div>

        <div class="menu-section" data-group="logs">
            <div class="menu-group-title">日志中心</div>
            <div class="menu-list">
                <button class="menu-btn" data-section="logs" onclick="fetchUserConnectionLogs(this)">连接日志</button>
                <button class="menu-btn" data-section="logs" onclick="fetchLoginLogs(this)">登录日志</button>
                <button class="menu-btn" data-section="logs" onclick="fetchSubscribeLogs(this)">订阅日志</button>
                <button class="menu-btn" data-section="logs" onclick="fetchRuleHits(this)">命中日志</button>
            </div>
        </div>

        
    </aside>
