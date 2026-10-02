<?php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class EmailInvitation extends Model
{
    protected $table = 'v2_email_invitation';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $hidden = ['token_hash','email_hash'];
    protected $casts = ['created_at'=>'timestamp','updated_at'=>'timestamp','expires_at'=>'integer','sent_at'=>'integer','accepted_at'=>'integer','failed_at'=>'integer','last_requested_at'=>'integer'];
}
