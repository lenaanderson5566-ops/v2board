<!DOCTYPE html>
<html>

<head>
    <link rel="stylesheet" href="/t1/d1/s1/res_002.css?v={{$version}}">
    <link rel="stylesheet" href="/t1/d1/s1/res_004.css?v={{$version}}">
    @if (file_exists(public_path("/t1/d1/s1/custom.css")))
        <link rel="stylesheet" href="/t1/d1/s1/custom.css?v={{$version}}">
    @endif
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,minimum-scale=1,user-scalable=no">
    @php ($colors = [
        'darkblue' => '#3b5998',
        'black' => '#343a40',
        'default' => '#0665d0',
        'green' => '#319795'
    ])
    <meta name="theme-color" content="{{$colors[$theme_config['theme_color']]}}">

    <title>{{$title}}</title>
    <!-- <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Nunito+Sans:300,400,400i,600,700"> -->
    <script>window.routerBase = "/";</script>
    <script>
        window.settings = {
            title: '{{$title}}',
            assets_path: '/t1/d1/s1',
            theme: {
                sidebar: '{{$theme_config['theme_sidebar']}}',
                header: '{{$theme_config['theme_header']}}',
                color: '{{$theme_config['theme_color']}}',
            },
            version: '{{$version}}',
            background_url: '{{$theme_config['background_url']}}',
            description: '{{$description}}',
            i18n: [
                'zh-CN',
                'en-US',
                'ja-JP',
                'vi-VN',
                'ko-KR',
                'zh-TW',
                'fa-IR'
            ],
            logo: '{{$logo}}'
        }
    </script>
    <script src="/t1/d1/s1/i18n/res_006.js?v={{$version}}"></script>
    <script src="/t1/d1/s1/i18n/res_007.js?v={{$version}}"></script>
    <script src="/t1/d1/s1/i18n/res_001.js?v={{$version}}"></script>
    <script src="/t1/d1/s1/i18n/res_003.js?v={{$version}}"></script>
    <script src="/t1/d1/s1/i18n/res_005.js?v={{$version}}"></script>
    <script src="/t1/d1/s1/i18n/res_004.js?v={{$version}}"></script>
    <script src="/t1/d1/s1/i18n/res_002.js?v={{$version}}"></script>
</head>

<body>
<div id="root"></div>
{!! $theme_config['custom_html'] !!}
<script src="/t1/d1/s1/res_006.js?v={{$version}}"></script>
<script src="/t1/d1/s1/res_001.js?v={{$version}}"></script>
<script src="/t1/d1/s1/res_005.js?v={{$version}}"></script>
@if (file_exists(public_path("/t1/d1/s1/custom.js")))
    <script src="/t1/d1/s1/custom.js?v={{$version}}"></script>
@endif
</body>

</html>
