<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        if (!Schema::hasTable('v2_server_v2box')) {
            DB::statement(<<<'SQL'
CREATE TABLE IF NOT EXISTS `v2_server_v2box` (
                                    `id` int(11) NOT NULL AUTO_INCREMENT,
                                    `group_id` varchar(255) NOT NULL,
                                    `route_id` varchar(255) DEFAULT NULL,
                                    `name` varchar(255) NOT NULL,
                                    `service_id` int(11) DEFAULT NULL,
                                    `region_code` varchar(2) DEFAULT NULL,
                                    `city_code` varchar(64) DEFAULT NULL,
                                    `display_label` varchar(64) DEFAULT NULL,
                                    `host` varchar(255) NOT NULL,
                                    `listen_ip` varchar(255) NOT NULL DEFAULT '0.0.0.0',
                                    `port` varchar(11) NOT NULL,
                                    `server_port` int(11) NOT NULL,
                                    `tags` varchar(255) DEFAULT NULL,
                                    `rate` varchar(11) NOT NULL,
                                    `show` tinyint(1) NOT NULL DEFAULT '0',
                                    `sort` int(11) DEFAULT NULL,
                                    `protocol` varchar(24) NOT NULL COMMENT '协议类型',
                                    `tls` tinyint(1) NOT NULL COMMENT 'tls类型',
                                    `tls_settings` text COMMENT 'tls配置',
                                    `flow` varchar(64) DEFAULT NULL COMMENT 'vless流控',
                                    `network` varchar(11) NOT NULL COMMENT '传输类型',
                                    `network_settings` text COMMENT '传输配置',
                                    `trusted_x_forwarded_for` varchar(255) DEFAULT NULL COMMENT '信任的x-forwarded-for头部',
                                    `encryption` varchar(64) DEFAULT NULL COMMENT 'vless加密',
                                    `encryption_settings` text COMMENT 'vless加密配置',
                                    `disable_sni` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'tuic禁用sni',
                                    `udp_relay_mode` varchar(64) DEFAULT NULL COMMENT 'tuic udp中继模式',
                                    `zero_rtt_handshake` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'tuic 0rtt握手',
                                    `congestion_control` varchar(64) DEFAULT NULL COMMENT 'tuic拥塞控制',
                                    `cipher` varchar(64) DEFAULT NULL COMMENT 'shadowsocks加密方式',
                                    `up_mbps` int(11) NOT NULL COMMENT 'hysteria上行带宽',
                                    `down_mbps` int(11) NOT NULL COMMENT 'hysteria下行带宽',
                                    `obfs` varchar(64) DEFAULT NULL COMMENT 'hysteria1混淆密码/hysteria2混淆类型',
                                    `obfs_password` varchar(255) DEFAULT NULL COMMENT 'hysteria2混淆密码',
                                    `padding_scheme` text COMMENT 'anytls填充配置',
                                    `created_at` int(11) NOT NULL,
                                    `updated_at` int(11) NOT NULL,
                                    PRIMARY KEY (`id`), KEY `proxy_service` (`service_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
SQL
            );
        }
    }
    public function down(): void { Schema::dropIfExists('v2_server_v2box'); }
};
