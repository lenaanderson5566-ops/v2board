<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{ $title }}</title>
    <style>
        body { font-family: Arial, sans-serif; background:#f3f4f6; margin:0; }
        .box { max-width:820px; margin:40px auto; padding:0 16px; }
        .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:18px; }
        h2 { margin:0 0 8px; }
        p { color:#6b7280; line-height:1.8; }
        a { color:#2563eb; text-decoration:none; }
    </style>
</head>
<body>
<div class="box">
    <div class="card">
        <h2>{{ $title }}</h2>
        <p>{{ $description }}</p>
        <a href="{{ '/' . $ops_path }}">返回运营中心</a>
    </div>
</div>
</body>
</html>
