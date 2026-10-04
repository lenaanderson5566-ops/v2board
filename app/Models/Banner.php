<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
class Banner extends Model
{
    protected $table = 'v2_banner';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    public function getImageUrlAttribute($value) { return $this->currentImageUrl($value); }
    public function getMobileImageUrlAttribute($value) { return $this->currentImageUrl($value); }
    private function currentImageUrl($value) {
        return is_string($value) ? str_replace('/api/v1/guest/banner/image/', '/api/v10/public/banner-images/', $value) : $value;
    }
    protected $casts = ['placements'=>'array', 'languages'=>'array', 'show'=>'boolean', 'sort'=>'integer', 'starts_at'=>'integer', 'ends_at'=>'integer', 'created_at'=>'timestamp', 'updated_at'=>'timestamp'];
}
