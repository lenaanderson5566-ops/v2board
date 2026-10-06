<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <link rel="icon" type="image/svg+xml" href="/console-mark.svg">
    <meta name="theme-color" content="#ffffff">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="description" content="{{ $boot['description'] }}">
    <title>{{ $boot['title'] }}</title>
    <script>window.V2BOARD = @json($boot);</script>
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
