<?php
$seed=env('FASTAI_ENTRYPOINT_SIGNING_SEED', '');
if (!is_string($seed)) $seed='';
if ($seed==='') {
    $seedFile=storage_path('app/fastai-entrypoint.seed');
    if (is_file($seedFile) && is_readable($seedFile)) $seed=trim(file_get_contents($seedFile));
}
return ['entrypoint_signing_seed'=>$seed];
