<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
class Banner extends Model
{
    protected $table = 'v2_banner';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = ['placements'=>'array', 'languages'=>'array', 'show'=>'boolean', 'sort'=>'integer', 'starts_at'=>'integer', 'ends_at'=>'integer', 'created_at'=>'timestamp', 'updated_at'=>'timestamp'];
}
