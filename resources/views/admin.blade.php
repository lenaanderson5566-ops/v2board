<!DOCTYPE html>
<html>

<head>
    <link rel="stylesheet" href="/s1/res_002.css?v={{$version}}">
    <link rel="stylesheet" href="/s1/res_004.css?v={{$version}}">
    <link rel="stylesheet" href="/s1/custom.css?v={{$version}}">
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,minimum-scale=1,user-scalable=no">
    <title>{{$title}}</title>
    <!-- <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Nunito+Sans:300,400,400i,600,700"> -->
    <script>window.routerBase = "/";</script>
    <script>
        window.settings = {
            title: '{{$title}}',
            theme: {
                sidebar: '{{$theme_sidebar}}',
                header: '{{$theme_header}}',
                color: '{{$theme_color}}',
            },
            version: '{{$version}}',
            background_url: '{{$background_url}}',
            logo: '{{$logo}}',
            secure_path: '{{$secure_path}}'
        }
    </script>
</head>

<body>
<div id="root"></div>
<script src="/s1/res_006.js?v={{$version}}"></script>
<script src="/s1/res_001.js?v={{$version}}"></script>
<script src="/s1/res_005.js?v={{$version}}"></script>
</body>

</html>
