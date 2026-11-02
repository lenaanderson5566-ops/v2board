<?php
namespace App\Support;

use Illuminate\Config\Repository;
use Illuminate\Support\Arr;

/** One settings tree for current names and installed-site compatibility. */
final class SiteConfigurationRepository extends Repository
{
    public function __construct(array $items = [])
    {
        if (!array_key_exists('fastai', $items) && array_key_exists('v2board', $items)) {
            $items['fastai'] = $items['v2board'];
        }
        unset($items['v2board']);
        parent::__construct($items);
    }

    private function canonicalKey($key)
    {
        if ($key === 'v2board') return 'fastai';
        if (is_string($key) && str_starts_with($key, 'v2board.')) return 'fastai'.substr($key, 7);
        return $key;
    }

    public function has($key)
    {
        return parent::has(is_array($key) ? array_map($this->canonicalKey(...), $key) : $this->canonicalKey($key));
    }

    public function get($key, $default = null)
    {
        return is_array($key) ? $this->getMany($key) : parent::get($this->canonicalKey($key), $default);
    }

    public function getMany($keys)
    {
        $values = [];
        foreach ($keys as $key => $default) {
            if (is_numeric($key)) [$key, $default] = [$default, null];
            $values[$key] = $this->get($key, $default);
        }
        return $values;
    }

    public function set($key, $value = null)
    {
        foreach (is_array($key) ? $key : [$key => $value] as $name => $item) {
            parent::set($this->canonicalKey($name), $item);
        }
    }

    public function offsetUnset($offset): void
    {
        Arr::forget($this->items, $this->canonicalKey($offset));
    }
}
