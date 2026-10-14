{!! $brand !!}

{!! $title !!}

{!! $body !!}

{!! $code !!}
{!! $contentText !!}
@if ($url)
{!! $action !!}: {!! $url !!}
@endif
@if ($sensitive)
{!! $ignore !!}
@endif

{!! $footer !!}

@if (!empty($unsubscribeUrl))
{!! $unsubscribeLabel !!}: {!! $unsubscribeUrl !!}
@endif
