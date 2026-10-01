<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="{{ config('v2board.app_description', 'V2Board') }}">
    <title>{{ config('v2board.app_name', 'V2Board') }}</title>
    <script>window.V2BOARD = @json($boot);</script>
    @foreach($entry['css'] ?? [] as $css)
        <link rel="stylesheet" href="{{ '/console/' . $css }}">
    @endforeach
</head>
<body>
    <div id="root"></div>
    @if($boot['mode'] === 'user')
        <footer id="custom-footer">{!! \App\Support\FrontendConfig::footer() !!}</footer>
    @endif
    <script type="module" src="{{ '/console/' . $entry['file'] }}"></script>
</body>
</html>
