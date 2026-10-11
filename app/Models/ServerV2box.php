<?php
namespace App\Models;

class ServerV2box extends ServerV2node
{
    public function getCasts() { return array_merge(parent::getCasts(), ['sing_box' => 'array']); }
    protected $table = 'v2_server_v2box';
}
