<!doctype html>
<html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;color:#222;background:#f7f7f7;padding:24px">
<div style="max-width:520px;margin:auto;background:white;border-radius:16px;padding:32px">
<h1 style="font-size:24px">{{ __('You are invited to :name', ['name'=>$name]) }}</h1>
<p>{{ __('Create an account using this email address. This private invitation expires in 7 days and can only be accepted once.') }}</p>
<p style="margin:28px 0"><a href="{{ $url }}" style="display:inline-block;background:#222;color:white;padding:14px 22px;border-radius:24px;text-decoration:none">{{ __('Accept invitation') }}</a></p>
<p style="color:#777;font-size:13px">{{ __('If you do not wish to join, you can ignore this email.') }}</p>
</div></body></html>
