<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#ffffff">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="description" content="{{ $boot['landing'] ? 'Studio — Device setup and connectivity guidance for AI apps.' : config('v2board.app_description', 'V2Board') }}">
    <title>{{ $boot['landing'] ? 'Studio' : config('v2board.app_name', 'V2Board') }}</title>
    <script>window.V2BOARD = @json($boot);</script>
    @if($boot['mode'] === 'admin')
        <link rel="stylesheet" href="/assets/admin/res_002.css">
        <link rel="stylesheet" href="/assets/admin/res_004.css">
    @endif
    @foreach($entry['css'] ?? [] as $css)
        <link rel="stylesheet" href="{{ '/console/' . $css }}">
    @endforeach
</head>
<body data-console="{{ $boot['mode'] }}">
    <div id="root"></div>
    @if($boot['mode'] === 'user' && !$boot['landing'])
        <footer id="custom-footer">{!! \App\Support\FrontendConfig::footer() !!}</footer>
    @endif
    <script type="module" src="{{ '/console/' . $entry['file'] }}"></script>
</body>
</html>
