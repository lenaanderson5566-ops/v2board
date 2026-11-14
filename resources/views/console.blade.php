@php
    $isWorkspaceAccess = $boot['mode'] === 'admin';
@endphp
<!doctype html>
<html lang="{{ $isWorkspaceAccess ? 'en-US' : 'zh-CN' }}"@if($isWorkspaceAccess) dir="ltr"@endif>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <link rel="icon" type="image/svg+xml" href="/console-mark.svg">
    <meta name="theme-color" content="#ffffff">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="description" content="{{ $isWorkspaceAccess ? 'Sign in to your workspace.' : $boot['description'] }}">
    <title>{{ $isWorkspaceAccess ? 'Workspace access' : $boot['title'] }}</title>
    <script>window.FASTAI = @json($boot); window.V2BOARD = window.FASTAI;</script>
    @foreach($entry['css'] ?? [] as $css)
        <link rel="stylesheet" href="{{ '/console/' . $css }}">
    @endforeach
</head>
<body data-console="{{ $boot['mode'] }}">
    <div id="root"></div>
    <noscript><p style="padding:24px;text-align:center">@unless($isWorkspaceAccess)请启用 JavaScript；若应用内无法显示，请复制当前网址到系统浏览器打开。<br>@endunless
        Please enable JavaScript or copy this address into your system browser.
    </p></noscript>
    @if($boot['mode'] === 'user' && !$boot['landing'])
        <footer id="custom-footer">{!! \App\Support\FrontendConfig::footer() !!}</footer>
    @endif
    <script type="module" src="{{ '/console/' . $entry['file'] }}"></script>
</body>
</html>
