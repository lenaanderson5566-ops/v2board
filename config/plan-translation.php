<?php
return [
    'url' => env('AZURE_TRANSLATOR_ENDPOINT', 'https://api.cognitive.microsofttranslator.com'),
    'key' => env('AZURE_TRANSLATOR_KEY', ''),
    'region' => env('AZURE_TRANSLATOR_REGION', ''),
];
