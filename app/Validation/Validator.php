<?php
namespace App\Validation;

// Older Laravel versions do not receive the newer email validation security fixes.
class Validator extends \Illuminate\Validation\Validator
{
    public function validateEmail($attribute, $value, $parameters)
    {
        if (!is_string($value) || preg_match('/[\x00-\x20\x7f]/', $value)) return false;
        return parent::validateEmail($attribute, $value, $parameters);
    }
}
