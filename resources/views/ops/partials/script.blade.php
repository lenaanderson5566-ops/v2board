@include('ops.partials.scripts.common')

@if(($mode ?? 'all') === 'risk')
@include('ops.partials.scripts.risk-center')
@elseif(($mode ?? 'all') === 'client')
@include('ops.partials.scripts.client-center')
@elseif(($mode ?? 'all') === 'logs')
@include('ops.partials.scripts.log-center')
@else
@include('ops.partials.scripts.risk-center')
@include('ops.partials.scripts.client-center')
@include('ops.partials.scripts.log-center')
@endif

@include('ops.partials.scripts.init')
