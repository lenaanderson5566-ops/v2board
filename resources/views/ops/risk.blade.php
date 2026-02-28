<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $title }} - Risk Control</title>
    <style>
@include('ops.partials.style')
        .layout.embedded .content { padding: 0; }
        .layout.embedded .container { max-width: none; }
        .layout.embedded .header { display:none; }
    </style>
</head>
<body>
@php($embedded = request()->boolean('embedded'))
<div id="guestBlock" style="display:none;max-width:680px;margin:80px auto;padding:24px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;">
    <h3 style="margin-top:0;">请先登录管理员后台</h3>
    <p style="color:#6b7280;line-height:1.7;">当前页面为风控后台，仅管理员可访问。检测到未登录状态，已隐藏全部风控数据界面。</p>
    <a id="guestLoginLink" href="#" style="display:inline-block;margin-top:8px;padding:8px 12px;border:1px solid #2563eb;border-radius:8px;color:#2563eb;text-decoration:none;">前往登录</a>
</div>
<div class="layout{{ $embedded ? ' embedded' : '' }}">
@unless($embedded)
@include('ops.partials.sidebar')
@endunless

    <main class="content">
        <div class="container">
            <div class="header">
                <div>
                    <h2 class="title" id="centerTitle">风控中心</h2>
                </div>
            </div>

            <div id="authState" class="status"></div>
            <div id="viewTitle" style="font-size:13px;color:#6b7280;margin-bottom:10px;">当前模块：风控参数配置</div>
            <div id="result" class="result-panel"></div>
        </div>
    </main>
</div>

<script>
@include('ops.partials.script')
</script>
</body>
</html>
