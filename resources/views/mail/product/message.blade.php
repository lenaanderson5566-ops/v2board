<!doctype html>
<html lang="{{ $language }}" dir="{{ $direction }}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{ $subject }}</title><style>@media (max-width:480px){.mail-shell{padding:16px 8px!important}.mail-card{padding:24px 20px!important}.mail-code{font-size:26px!important;letter-spacing:5px!important;padding:16px 10px!important}}</style></head>
<body style="margin:0;background:#f7f7f6;color:#202123;font-family:Arial,sans-serif;line-height:1.7">
<div style="display:none;max-height:0;overflow:hidden">{{ $body }}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td class="mail-shell" align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px"><tr><td style="padding:0 8px 24px;font-size:20px;font-weight:bold">{{ $brand }}</td></tr>
<tr><td class="mail-card" style="background:#fff;border:1px solid #e8e8e6;border-radius:20px;padding:32px">
<h1 style="font-size:24px;line-height:1.4;margin:0 0 20px">{{ $title }}</h1>
<p style="color:#626262;margin:0 0 24px">{{ $body }}</p>
@if ($code)<div class="mail-code" dir="ltr" style="background:#f4f4f3;border-radius:12px;padding:20px;text-align:center;letter-spacing:8px;font-size:32px;font-weight:bold">{{ $code }}</div>@endif
@if ($contentHtml)<div style="overflow-wrap:anywhere">{!! $contentHtml !!}</div>@endif
@if ($url)<p style="margin:28px 0"><a href="{{ $url }}" style="display:inline-block;background:#202123;color:#fff;text-decoration:none;border-radius:24px;padding:12px 24px">{{ $action }}</a></p>@endif
@if ($sensitive)<p style="font-size:13px;color:#777;margin-top:24px">{{ $ignore }}</p>@endif
</td></tr><tr><td style="padding:24px 8px;font-size:12px;color:#777">{{ $brand }}<br>{{ $footer }}</td></tr></table>
</td></tr></table></body></html>
