<?php

namespace App\Utils;

class CacheKey
{
    CONST KEYS = [
        'EMAIL_VERIFY_CODE' => '邮箱验证码',
        'LAST_SEND_EMAIL_VERIFY_TIMESTAMP' => '最后一次发送邮箱验证码时间',
        'SERVER_V2BOX_ONLINE_USER' => 'v2box节点在线用户',
        'SERVER_V2BOX_LAST_CHECK_AT' => 'v2box节点最后检查时间',
        'SERVER_V2BOX_LAST_PUSH_AT' => 'v2box节点最后推送时间',
        'SERVER_V2NODE_ONLINE_USER' => 'v2node节点在线用户',
        'SERVER_V2NODE_LAST_CHECK_AT' => 'v2node节点最后检查时间',
        'SERVER_V2NODE_LAST_PUSH_AT' => 'v2node节点最后推送时间',
        'LAST_SEND_EMAIL_REMIND_TRAFFIC' => '最后发送流量邮件提醒',
        'SCHEDULE_LAST_CHECK_AT' => '计划任务最后检查时间',
        'REGISTER_IP_RATE_LIMIT' => '注册频率限制',
        'PASSWORD_ERROR_LIMIT' => '密码错误次数限制',
        'USER_SESSIONS' => '用户session',
        'FORGET_REQUEST_LIMIT' => '找回密码次数限制'
    ];

    public static function get(string $key, $uniqueValue)
    {
        if (!in_array($key, array_keys(self::KEYS))) {
            abort(500, 'key is not in cache key list');
        }
        return $key . '_' . $uniqueValue;
    }
}
