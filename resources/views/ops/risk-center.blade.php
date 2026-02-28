@include('risk', [
    'title' => config('v2board.app_name', 'V2Board'),
    'api_path' => config('v2board.ops_api_path', 'ops'),
    'mode' => 'risk'
])
