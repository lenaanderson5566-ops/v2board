@include('risk.partials.scripts.common')

@if(($mode ?? 'all') === 'risk')
@include('risk.partials.scripts.risk-center')
@elseif(($mode ?? 'all') === 'client')
@include('risk.partials.scripts.client-center')
@elseif(($mode ?? 'all') === 'logs')
@include('risk.partials.scripts.log-center')
@else
@include('risk.partials.scripts.risk-center')
@include('risk.partials.scripts.client-center')
@include('risk.partials.scripts.log-center')
@endif

@include('risk.partials.scripts.init')
