<?php
$seedFile=storage_path('app/fastai-entrypoint.seed');
return ['entrypoint_signing_seed' => env('FASTAI_ENTRYPOINT_SIGNING_SEED', is_file($seedFile) ? trim(file_get_contents($seedFile)) : '')];
