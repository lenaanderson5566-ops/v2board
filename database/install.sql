-- Adminer 4.8.1 MySQL 5.7.29 dump

SET NAMES utf8;
SET time_zone = '+00:00';
SET foreign_key_checks = 0;
SET sql_mode = 'NO_AUTO_VALUE_ON_ZERO';

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_email_invitation` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `email` varchar(254) NOT NULL,
  `email_hash` varchar(64) NOT NULL,
  `token_hash` varchar(64) NOT NULL,
  `accepted_user_id` int unsigned DEFAULT NULL,
  `expires_at` bigint unsigned NOT NULL,
  `sent_at` bigint unsigned DEFAULT NULL,
  `failed_at` bigint unsigned DEFAULT NULL,
  `accepted_at` bigint unsigned DEFAULT NULL,
  `last_requested_at` bigint unsigned NOT NULL,
  `created_at` bigint unsigned NOT NULL,
  `updated_at` bigint unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email_invitation_token_unique` (`token_hash`),
  UNIQUE KEY `email_invitation_recipient_unique` (`user_id`, `email_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS `failed_jobs`;
CREATE TABLE `failed_jobs` (
                               `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
                               `connection` text COLLATE utf8mb4_unicode_ci NOT NULL,
                               `queue` text COLLATE utf8mb4_unicode_ci NOT NULL,
                               `payload` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
                               `exception` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
                               `failed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
                               PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


DROP TABLE IF EXISTS `v2_commission_log`;
CREATE TABLE `v2_commission_log` (
  `currency` varchar(3) NOT NULL DEFAULT 'CNY',
  `order_currency` varchar(3) NOT NULL DEFAULT 'CNY',
                                     `id` int(11) NOT NULL AUTO_INCREMENT,
                                     `invite_user_id` int(11) NOT NULL,
                                     `user_id` int(11) NOT NULL,
                                     `trade_no` char(36) NOT NULL,
                                     `order_amount` int(11) NOT NULL,
                                     `get_amount` int(11) NOT NULL,
                                     `created_at` int(11) NOT NULL,
                                     `updated_at` int(11) NOT NULL,
                                     PRIMARY KEY (`id`),
                                     KEY `commission_created_currency` (`created_at`,`currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


DROP TABLE IF EXISTS `v2_coupon`;
CREATE TABLE `v2_coupon` (
  `public_claim` tinyint(1) NOT NULL DEFAULT 0,
                             `id` int(11) NOT NULL AUTO_INCREMENT,
                             `code` varchar(255) NOT NULL,
                             `name` varchar(255) CHARACTER SET utf8mb4 NOT NULL,
                             `type` tinyint(1) NOT NULL,
                             `value` int(11) NOT NULL,
                             `show` tinyint(1) NOT NULL DEFAULT '0',
                             `limit_use` int(11) DEFAULT NULL,
                             `limit_use_with_user` int(11) DEFAULT NULL,
                             `limit_plan_ids` varchar(255) DEFAULT NULL,
                             `limit_period` varchar(255) DEFAULT NULL,
                             `started_at` int(11) NOT NULL,
                             `ended_at` int(11) NOT NULL,
                             `created_at` int(11) NOT NULL,
                             `updated_at` int(11) NOT NULL,
                             PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


DROP TABLE IF EXISTS `v2_giftcard`;
CREATE TABLE `v2_giftcard` (
                             `id` int(11) NOT NULL AUTO_INCREMENT,
                             `code` varchar(255) NOT NULL,
                             `name` varchar(255) CHARACTER SET utf8mb4 NOT NULL,
                             `type` tinyint(1) NOT NULL,
                             `value` int(11) DEFAULT NULL,
                             `plan_id` int(11) DEFAULT NULL,
                             `limit_use` int(11) DEFAULT NULL,
                             `used_user_ids` varchar(16384) DEFAULT NULL,
                             `started_at` int(11) NOT NULL,
                             `ended_at` int(11) NOT NULL,
                             `created_at` int(11) NOT NULL,
                             `updated_at` int(11) NOT NULL,
                             PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


DROP TABLE IF EXISTS `v2_invite_code`;
CREATE TABLE `v2_invite_code` (
                                  `id` int(11) NOT NULL AUTO_INCREMENT,
                                  `user_id` int(11) NOT NULL,
                                  `code` char(32) NOT NULL,
                                  `status` tinyint(1) NOT NULL DEFAULT '0',
                                  `pv` int(11) NOT NULL DEFAULT '0',
                                  `created_at` int(11) NOT NULL,
                                  `updated_at` int(11) NOT NULL,
                                  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


DROP TABLE IF EXISTS `v2_knowledge`;
CREATE TABLE `v2_knowledge` (
                                `id` int(11) NOT NULL AUTO_INCREMENT,
                                `language` char(5) NOT NULL COMMENT '語言',
                                `category` varchar(255) NOT NULL COMMENT '分類名',
                                `title` varchar(255) NOT NULL COMMENT '標題',
                                `body` text NOT NULL COMMENT '內容',
                                `sort` int(11) DEFAULT NULL COMMENT '排序',
                                `show` tinyint(1) NOT NULL DEFAULT '0' COMMENT '顯示',
                                `created_at` int(11) NOT NULL COMMENT '創建時間',
                                `updated_at` int(11) NOT NULL COMMENT '更新時間',
                                PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='知識庫';


DROP TABLE IF EXISTS `v2_log`;
CREATE TABLE `v2_log` (
                          `id` int(11) NOT NULL AUTO_INCREMENT,
                          `title` text NOT NULL,
                          `level` varchar(11) DEFAULT NULL,
                          `host` varchar(255) DEFAULT NULL,
                          `uri` varchar(255) NOT NULL,
                          `method` varchar(11) NOT NULL,
                          `data` text,
                          `ip` varchar(128) DEFAULT NULL,
                          `context` text,
                          `created_at` int(11) NOT NULL,
                          `updated_at` int(11) NOT NULL,
                          PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


DROP TABLE IF EXISTS `v2_mail_log`;
CREATE TABLE `v2_mail_log` (
  `stream` varchar(24) DEFAULT NULL,
  `delivery_status` varchar(24) DEFAULT NULL,
  `delivery_at` int unsigned DEFAULT NULL,
  KEY `v2_mail_log_stream_index` (`stream`),
  KEY `v2_mail_log_delivery_status_index` (`delivery_status`),
  KEY `mail_provider_message` (`provider`,`message_id`),
                               `id` int(11) NOT NULL AUTO_INCREMENT,
                               `email` varchar(64) NOT NULL,
                               `subject` varchar(255) NOT NULL,
                               `template_name` varchar(255) NOT NULL,
                               `error` text,
                               `created_at` int(11) NOT NULL,
                               `updated_at` int(11) NOT NULL,
                               `transport_code` smallint unsigned DEFAULT NULL,
                               `enhanced_code` varchar(11) DEFAULT NULL,
                               `user_id` bigint unsigned DEFAULT NULL,
                               KEY `v2_mail_log_user_id_index` (`user_id`),
                               `provider` varchar(24) DEFAULT NULL,
                               `status` varchar(24) DEFAULT NULL,
                               `error_code` varchar(64) DEFAULT NULL,
                               `message_id` varchar(255) DEFAULT NULL,
                               `recipient_hash` varchar(64) DEFAULT NULL,
                               `duration_ms` int unsigned DEFAULT NULL,
                               KEY `v2_mail_log_recipient_hash_index` (`recipient_hash`),
                               KEY `mail_delivery_created_id` (`created_at`, `id`),
                               PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


DROP TABLE IF EXISTS `v2_notice`;
CREATE TABLE `v2_notice` (
                             `id` int(11) NOT NULL AUTO_INCREMENT,
                             `title` varchar(255) NOT NULL,
                             `content` text NOT NULL,
                             `show` tinyint(1) NOT NULL DEFAULT '0',
                             `img_url` varchar(255) DEFAULT NULL,
                             `tags` varchar(255) DEFAULT NULL,
                             `created_at` int(11) NOT NULL,
                             `updated_at` int(11) NOT NULL,
                             PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


DROP TABLE IF EXISTS `v2_order`;
CREATE TABLE `v2_order` (
  `currency` varchar(3) NOT NULL DEFAULT 'CNY',
  `fx_snapshot` text DEFAULT NULL,
                            `id` int(11) NOT NULL AUTO_INCREMENT,
                            `invite_user_id` int(11) DEFAULT NULL,
                            `user_id` int(11) NOT NULL,
                            `plan_id` int(11) NOT NULL,
                            `coupon_id` int(11) DEFAULT NULL,
                            `payment_id` int(11) DEFAULT NULL,
                            `type` int(11) NOT NULL COMMENT '1新购2续费3升级',
                            `period` varchar(255) NOT NULL,
                            `trade_no` varchar(36) NOT NULL,
                            `callback_no` varchar(255) DEFAULT NULL,
                            `total_amount` int(11) NOT NULL,
                            `handling_amount` int(11) DEFAULT NULL,
                            `discount_amount` int(11) DEFAULT NULL,
                            `surplus_amount` int(11) DEFAULT NULL COMMENT '剩余价值',
                            `refund_amount` int(11) DEFAULT NULL COMMENT '退款金额',
                            `balance_amount` int(11) DEFAULT NULL COMMENT '使用余额',
                            `surplus_order_ids` text COMMENT '折抵订单',
                            `status` tinyint(1) NOT NULL DEFAULT '0' COMMENT '0待支付1开通中2已取消3已完成4已折抵',
                            `commission_status` tinyint(1) NOT NULL DEFAULT '0' COMMENT '0待确认1发放中2有效3无效',
                            `commission_balance` int(11) NOT NULL DEFAULT '0',
                            `actual_commission_balance` int(11) DEFAULT NULL COMMENT '实际支付佣金',
                            `paid_at` int(11) DEFAULT NULL,
                            `created_at` int(11) NOT NULL,
                            `updated_at` int(11) NOT NULL,
                            PRIMARY KEY (`id`),
                            UNIQUE KEY `trade_no` (`trade_no`),
                            INDEX idx_user (`user_id`),
                            INDEX idx_user_status (`user_id`, `status`),
                            KEY `order_paid_currency` (`paid_at`,`status`,`currency`),
                            KEY `order_pending_commission` (`commission_status`,`commission_balance`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


DROP TABLE IF EXISTS `v2_payment`;
CREATE TABLE `v2_payment` (
  `currency` varchar(3) NOT NULL DEFAULT 'CNY',
                              `id` int(11) NOT NULL AUTO_INCREMENT,
                              `uuid` char(32) NOT NULL,
                              `payment` varchar(16) NOT NULL,
                              `name` varchar(255) NOT NULL,
                              `icon` varchar(255) DEFAULT NULL,
                              `config` text NOT NULL,
                              `notify_domain` varchar(128) DEFAULT NULL,
                              `handling_fee_fixed` int(11) DEFAULT NULL,
                              `handling_fee_percent` decimal(5,2) DEFAULT NULL,
                              `enable` tinyint(1) NOT NULL DEFAULT '0',
                              `sort` int(11) DEFAULT NULL,
                              `created_at` int(11) NOT NULL,
                              `updated_at` int(11) NOT NULL,
                              PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


DROP TABLE IF EXISTS `v2_plan`;
CREATE TABLE `v2_plan` (
  `usd_prices` text DEFAULT NULL,
                           `id` int(11) NOT NULL AUTO_INCREMENT,
                           `group_id` int(11) NOT NULL,
                           `transfer_enable` int(11) NOT NULL,
                           `device_limit` int(11) DEFAULT NULL,
                           `name` varchar(255) NOT NULL,
                           `speed_limit` int(11) DEFAULT NULL,
                           `show` tinyint(1) NOT NULL DEFAULT '0',
                           `sort` int(11) DEFAULT NULL,
                           `renew` tinyint(1) NOT NULL DEFAULT '1',
                           `content` text,
                           `month_price` int(11) DEFAULT NULL,
                           `quarter_price` int(11) DEFAULT NULL,
                           `half_year_price` int(11) DEFAULT NULL,
                           `year_price` int(11) DEFAULT NULL,
                           `two_year_price` int(11) DEFAULT NULL,
                           `three_year_price` int(11) DEFAULT NULL,
                           `onetime_price` int(11) DEFAULT NULL,
                           `reset_price` int(11) DEFAULT NULL,
                           `reset_traffic_method` tinyint(1) DEFAULT NULL,
                           `capacity_limit` int(11) DEFAULT NULL,
                           `created_at` int(11) NOT NULL,
                           `updated_at` int(11) NOT NULL,
                           PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


DROP TABLE IF EXISTS `v2_server_group`;
CREATE TABLE `v2_server_group` (
                                   `id` int(11) NOT NULL AUTO_INCREMENT,
                                   `name` varchar(255) NOT NULL,
                                   `created_at` int(11) NOT NULL,
                                   `updated_at` int(11) NOT NULL,
                                   PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


DROP TABLE IF EXISTS `v2_server_route`;
CREATE TABLE `v2_server_route` (
                                   `id` int(11) NOT NULL AUTO_INCREMENT,
                                   `remarks` varchar(255) NOT NULL,
                                   `match` text NOT NULL,
                                   `action` varchar(11) NOT NULL,
                                   `action_value` text DEFAULT NULL,
                                   `created_at` int(11) NOT NULL,
                                   `updated_at` int(11) NOT NULL,
                                   PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


DROP TABLE IF EXISTS `v2_server_v2node`;
CREATE TABLE `v2_server_v2node` (
                                    `id` int(11) NOT NULL AUTO_INCREMENT,
                                    `group_id` varchar(255) NOT NULL,
                                    `route_id` varchar(255) DEFAULT NULL,
                                    `name` varchar(255) NOT NULL,
                                    `parent_id` int(11) DEFAULT NULL,
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
                                    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS `v2_stat`;
CREATE TABLE `v2_stat` (
                           `id` int(11) NOT NULL AUTO_INCREMENT,
                           `record_at` int(11) NOT NULL,
                           `record_type` char(1) NOT NULL,
                           `order_count` int(11) NOT NULL COMMENT '订单数量',
                           `order_total` int(11) NOT NULL COMMENT '订单合计',
                           `commission_count` int(11) NOT NULL,
                           `commission_total` int(11) NOT NULL COMMENT '佣金合计',
                           `paid_count` int(11) NOT NULL,
                           `paid_total` int(11) NOT NULL,
                           `register_count` int(11) NOT NULL,
                           `invite_count` int(11) NOT NULL,
                           `transfer_used_total` varchar(32) NOT NULL,
                           `created_at` int(11) NOT NULL,
                           `updated_at` int(11) NOT NULL,
                           PRIMARY KEY (`id`),
                           UNIQUE KEY `record_at` (`record_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COMMENT='订单统计';


DROP TABLE IF EXISTS `v2_stat_server`;
CREATE TABLE `v2_stat_server` (
                                  `id` int(11) NOT NULL AUTO_INCREMENT,
                                  `server_id` int(11) NOT NULL COMMENT '节点id',
                                  `server_type` char(11) NOT NULL COMMENT '节点类型',
                                  `u` bigint(20) NOT NULL,
                                  `d` bigint(20) NOT NULL,
                                  `record_type` char(1) NOT NULL COMMENT 'd day m month',
                                  `record_at` int(11) NOT NULL COMMENT '记录时间',
                                  `created_at` int(11) NOT NULL,
                                  `updated_at` int(11) NOT NULL,
                                  PRIMARY KEY (`id`),
                                  UNIQUE KEY `server_id_server_type_record_at` (`server_id`,`server_type`,`record_at`),
                                  KEY `record_at` (`record_at`),
                                  KEY `server_id` (`server_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COMMENT='节点数据统计';


DROP TABLE IF EXISTS `v2_stat_user`;
CREATE TABLE `v2_stat_user` (
  `record_timezone` varchar(64) DEFAULT NULL,
                                `id` int(11) NOT NULL AUTO_INCREMENT,
                                `user_id` int(11) NOT NULL,
                                `server_rate` decimal(10,2) NOT NULL,
                                `u` bigint(20) NOT NULL,
                                `d` bigint(20) NOT NULL,
                                `record_type` char(2) NOT NULL,
                                `record_at` int(11) NOT NULL,
                                `created_at` int(11) NOT NULL,
                                `updated_at` int(11) NOT NULL,
                                PRIMARY KEY (`id`),
                                UNIQUE KEY `server_rate_user_id_record_at` (`server_rate`,`user_id`,`record_at`),
                                KEY `user_id` (`user_id`),
                                KEY `record_at` (`record_at`),
                                KEY `server_rate` (`server_rate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


DROP TABLE IF EXISTS `v2_ticket`;
CREATE TABLE `v2_ticket` (
                             `id` int(11) NOT NULL AUTO_INCREMENT,
                             `user_id` int(11) NOT NULL,
                             `subject` varchar(255) NOT NULL,
                             `level` tinyint(1) NOT NULL,
                             `status` tinyint(1) NOT NULL DEFAULT '0' COMMENT '0:已开启 1:已关闭',
                             `reply_status` tinyint(1) NOT NULL DEFAULT '0' COMMENT '0:待回复 1:已回复',
                             `created_at` int(11) NOT NULL,
                             `updated_at` int(11) NOT NULL,
                             PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


DROP TABLE IF EXISTS `v2_ticket_message`;
CREATE TABLE `v2_ticket_message` (
                                     `id` int(11) NOT NULL AUTO_INCREMENT,
                                     `user_id` int(11) NOT NULL,
                                     `ticket_id` int(11) NOT NULL,
                                     `message` text CHARACTER SET utf8mb4 NOT NULL,
                                     `created_at` int(11) NOT NULL,
                                     `updated_at` int(11) NOT NULL,
                                     PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


DROP TABLE IF EXISTS `v2_user`;
CREATE TABLE `v2_user` (
  `account_deleted_at` bigint unsigned DEFAULT NULL,
  `currency` varchar(3) NOT NULL DEFAULT 'CNY',
  `announcement_email` tinyint(1) NOT NULL DEFAULT 0,
  `display_timezone` varchar(64) DEFAULT NULL,
                           `id` int(11) NOT NULL AUTO_INCREMENT,
                           `invite_user_id` int(11) DEFAULT NULL,
                           `telegram_id` bigint(20) DEFAULT NULL,
                           `email` varchar(64) NOT NULL,
                           `password` varchar(64) NOT NULL,
                           `password_algo` char(10) DEFAULT NULL,
                           `password_salt` char(10) DEFAULT NULL,
                           `balance` int(11) NOT NULL DEFAULT '0',
                           `discount` int(11) DEFAULT NULL,
                           `commission_type` tinyint(4) NOT NULL DEFAULT '0' COMMENT '0: system 1: period 2: onetime',
                           `commission_rate` int(11) DEFAULT NULL,
                           `commission_balance` int(11) NOT NULL DEFAULT '0',
                           `t` int(11) NOT NULL DEFAULT '0',
                           `u` bigint(20) NOT NULL DEFAULT '0',
                           `d` bigint(20) NOT NULL DEFAULT '0',
                           `transfer_enable` bigint(20) NOT NULL DEFAULT '0',
                           `device_limit` int(11) DEFAULT NULL,
                           `banned` tinyint(1) NOT NULL DEFAULT '0',
                           `is_admin` tinyint(1) NOT NULL DEFAULT '0',
                           `last_login_at` int(11) DEFAULT NULL,
                           `last_login_ip` int(11) DEFAULT NULL,
                           `uuid` varchar(36) NOT NULL,
                           `group_id` int(11) DEFAULT NULL,
                           `plan_id` int(11) DEFAULT NULL,
                           `speed_limit` int(11) DEFAULT NULL,
                           `auto_renewal` tinyint(4) DEFAULT '0',
                           `remind_expire` tinyint(4) DEFAULT '1',
                           `remind_traffic` tinyint(4) DEFAULT '1',
                           `remind_service` tinyint(1) NOT NULL DEFAULT '1',
                           `language` varchar(10) DEFAULT NULL,
                           `token` char(32) NOT NULL,
                           `expired_at` bigint(20) DEFAULT '0',
                           `remarks` text,
                           `created_at` int(11) NOT NULL,
                           `updated_at` int(11) NOT NULL,
                           PRIMARY KEY (`id`),
                           UNIQUE KEY `email` (`email`),
                           UNIQUE KEY `token` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


-- 2025-09-12 10:05:00

CREATE TABLE IF NOT EXISTS `v2_usage_reset_batch` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `request_key` varchar(64) NOT NULL,
  `actor_id` int NOT NULL,
  `kind` varchar(16) NOT NULL,
  `payload_hash` varchar(64) NOT NULL,
  `affected` int NOT NULL DEFAULT 0,
  `created_at` int NOT NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `v2_usage_reset_batch_request_key_unique` (`request_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_usage_reset_credit` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `batch_id` bigint unsigned NOT NULL,
  `quantity` int NOT NULL,
  `remaining` int NOT NULL,
  `expires_at` bigint DEFAULT NULL,
  `created_at` int NOT NULL,
  PRIMARY KEY (`id`), KEY `v2_usage_reset_credit_user_id_index` (`user_id`),
  UNIQUE KEY `v2_usage_reset_credit_batch_id_user_id_unique` (`batch_id`,`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_usage_reset_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `actor_id` int NOT NULL,
  `credit_id` bigint unsigned DEFAULT NULL,
  `batch_id` bigint unsigned DEFAULT NULL,
  `kind` varchar(16) NOT NULL,
  `quantity` int NOT NULL DEFAULT 0,
  `u_before` bigint NOT NULL DEFAULT 0,
  `d_before` bigint NOT NULL DEFAULT 0,
  `request_key` varchar(64) DEFAULT NULL,
  `created_at` int NOT NULL,
  PRIMARY KEY (`id`), KEY `v2_usage_reset_log_user_id_created_at_index` (`user_id`,`created_at`),
  UNIQUE KEY `v2_usage_reset_log_user_id_request_key_unique` (`user_id`,`request_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS `v2_plan_translation`;
CREATE TABLE `v2_plan_translation` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `plan_id` int(11) NOT NULL,
  `locale` varchar(16) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `content` text,
  `created_at` int(11) NOT NULL,
  `updated_at` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_plan_locale_unique` (`plan_id`,`locale`),
  KEY `idx_locale` (`locale`),
  CONSTRAINT `fk_plan_translation_plan` FOREIGN KEY (`plan_id`) REFERENCES `v2_plan` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_notice_read` (
  `user_id` int NOT NULL,
  `notice_id` int NOT NULL,
  `notice_updated_at` int unsigned NOT NULL,
  `read_at` int unsigned NOT NULL,
  PRIMARY KEY (`user_id`, `notice_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Independent traffic credits. Balances are bytes, separate from money and usage reset counts.
ALTER TABLE `v2_user` ADD COLUMN `credit_balance` bigint unsigned NOT NULL DEFAULT 0,
  ADD COLUMN `credit_migrated_at` int unsigned NULL;
ALTER TABLE `v2_order` ADD COLUMN `credit_bytes` bigint unsigned NULL,
  ADD COLUMN `credit_snapshot` text NULL;
CREATE TABLE IF NOT EXISTS `v2_traffic_credit_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `reference` varchar(80) NOT NULL,
  `kind` varchar(20) NOT NULL,
  `bytes` bigint unsigned NOT NULL,
  `snapshot` text NOT NULL,
  `created_at` int unsigned NOT NULL,
  PRIMARY KEY (`id`), UNIQUE KEY (`reference`), KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `v2_order` ADD COLUMN `payment_snapshot` json NULL;

/* Independent V2Box nodes share the V2Node schema. */
CREATE TABLE IF NOT EXISTS `v2_server_v2box` LIKE `v2_server_v2node`;

/* Default exact-match UA blacklist. Hex strings keep UA semicolons compatible with the installer SQL splitter. */
CREATE TABLE IF NOT EXISTS `v2_risk_blacklist_ua_hash` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `value` varchar(64) NOT NULL,
  `ua_raw` text NULL,
  `remark` varchar(255) NULL,
  `is_enabled` tinyint NOT NULL DEFAULT 1,
  `created_at` int NULL,
  `updated_at` int NULL,
  PRIMARY KEY (`id`), UNIQUE KEY (`value`), KEY (`is_enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `v2_risk_blacklist_ua_hash` (`value`, `ua_raw`, `remark`, `is_enabled`, `created_at`, `updated_at`) VALUES
('83c6c7781375fe23d1a2571fa744e294ffedca030442d814ca2873accf995af4', X'5353442F312E302E30', 'default_ua_blacklist', 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('aaa62e6a5fbc496424c76971bc90a12fe98182ed76874b485ec80ef107a15699', X'536861646F77736F636B73582D4E472F312E392E34', 'default_ua_blacklist', 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('786b33926cdfb58cb2c2385e41b2ad0f04bf7bb10e0914d6016f637598280224', X'53757266626F6172642F322E31352E30', 'default_ua_blacklist', 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('75459e6dfd132cc7cb3661bd9e302db186473559c55c2bc0ea9784d9dfc05580', X'53757267652F342E302E3020286950686F6E653B20694F532031332E303B205363616C652F332E303029', 'default_ua_blacklist', 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('43b89cdf090f6cfe63a4f4df57982209c0ed8a82106b7f458bfb6245d0058c65', X'4C6F6F6E2F322E312E3020286950686F6E653B20694F532031352E303B205363616C652F332E303029', 'default_ua_blacklist', 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('7406ac37dbc670d595c409349312767626d3798f7fc4a420c5b4c5bdbb764198', X'536861646F77726F636B65742F312E392E3820286950686F6E653B20694F532031352E303B205363616C652F332E303029', 'default_ua_blacklist', 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('7dbcfc3317c6757443baf726514a458daece443c32bfdb5d5880232841cd4700', X'76327261794E472F312E382E35', 'default_ua_blacklist', 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('18b1b4b1b316d51cc1f86739a74cfb28ceb863fbdcdda0e576ba3474156091c1', X'76327261794E2F362E3233', 'default_ua_blacklist', 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('78b28038a6f21a092e765b0282caa42c25d2a6a937b1a604dd0e4d094124fe1e', X'436C617368522F312E342E30', 'default_ua_blacklist', 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('14d3f235c661a0290f869f3d4c4d7d2de4b708a1835c38f3244468d2a0a1379e', X'636C6173682D76657267652F76312E332E38', 'default_ua_blacklist', 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
('63279522febcf5538b72996c16a8660ff177cd5536e86fb9c2a577bf32a65430', X'4D6F7A696C6C612F352E30202857696E646F7773204E542031302E303B2057696E36343B2078363429204170706C655765624B69742F3533372E3336', 'default_ua_blacklist', 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP())
ON DUPLICATE KEY UPDATE `value` = `value`;

CREATE TABLE IF NOT EXISTS `v2_payment_callback_event` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_id` int unsigned NULL,
  `payment_id` int unsigned NULL,
  `provider` varchar(64) NOT NULL,
  `stage` varchar(24) NOT NULL,
  `result` varchar(24) NOT NULL,
  `reason` varchar(64) NULL,
  `request_id` varchar(36) NULL,
  `created_at` int unsigned NOT NULL,
  PRIMARY KEY (`id`),
  KEY `v2_payment_callback_event_order_id_created_at_index` (`order_id`,`created_at`),
  KEY `v2_payment_callback_event_payment_id_created_at_index` (`payment_id`,`created_at`),
  KEY `v2_payment_callback_event_created_at_index` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_client_diagnostic_report` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT, `user_id` int unsigned NOT NULL,
 `report_id` char(36) NOT NULL, `report_kind` varchar(16) NOT NULL DEFAULT 'diagnostic', `client_version` varchar(32) NOT NULL, `platform` varchar(16) NOT NULL,
 `checks` json NOT NULL, `created_at` int unsigned NOT NULL,
 PRIMARY KEY (`id`), UNIQUE KEY (`report_id`), KEY (`user_id`), KEY (`created_at`), KEY (`report_kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_registration_signal` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT, `user_id` int unsigned NOT NULL,
 `ip_hash` varchar(64) NULL, `ua_hash` varchar(64) NULL, `created_at` int unsigned NOT NULL,
 PRIMARY KEY (`id`), UNIQUE KEY (`user_id`), KEY (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_invitation_review` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT, `user_id` int unsigned NOT NULL, `inviter_id` int unsigned NOT NULL,
 `signals` json NOT NULL, `state` varchar(24) NOT NULL DEFAULT 'pending', `revision` int unsigned NOT NULL DEFAULT 0,
 `created_at` int unsigned NOT NULL, `updated_at` int unsigned NOT NULL,
 PRIMARY KEY (`id`), UNIQUE KEY (`user_id`), KEY (`inviter_id`), KEY (`state`), KEY (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_invitation_review_event` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT, `review_id` bigint unsigned NOT NULL,
 `admin_id` int unsigned NOT NULL, `state` varchar(24) NOT NULL, `note` varchar(1000) NOT NULL, `created_at` int unsigned NOT NULL,
 PRIMARY KEY (`id`), KEY (`review_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_telegram_binding_challenge` (
 `user_id` bigint unsigned NOT NULL, `token_hash` char(64) NOT NULL,
 `telegram_id` bigint DEFAULT NULL, `telegram_name` varchar(128) DEFAULT NULL,
 `expires_at` int unsigned NOT NULL, PRIMARY KEY (`user_id`), UNIQUE KEY (`token_hash`), KEY (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_telegram_group_member` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT, `chat_id` bigint NOT NULL, `telegram_id` bigint NOT NULL,
 `status` varchar(32) NOT NULL DEFAULT 'pending', `policy_banned` tinyint(1) NOT NULL DEFAULT 0,
 `next_check_at` int unsigned NOT NULL DEFAULT 0, `checked_at` int unsigned DEFAULT NULL,
 `error_code` varchar(48) DEFAULT NULL, PRIMARY KEY (`id`), UNIQUE KEY (`chat_id`,`telegram_id`), KEY (`next_check_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_telegram_preference` (
  `user_id` bigint unsigned NOT NULL PRIMARY KEY, `telegram_id` bigint NOT NULL,
  `expiry` tinyint(1) NOT NULL DEFAULT 0, `ticket` tinyint(1) NOT NULL DEFAULT 0,
  `order` tinyint(1) NOT NULL DEFAULT 0, `quiet` tinyint(1) NOT NULL DEFAULT 1,
  `blocked` tinyint(1) NOT NULL DEFAULT 0, `updated_at` int unsigned NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_telegram_notification` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, `event_key` char(64) NOT NULL UNIQUE,
  `user_id` bigint unsigned NOT NULL, `telegram_id` bigint NOT NULL, `kind` varchar(24) NOT NULL,
  `reference_id` bigint unsigned DEFAULT NULL, `status` varchar(16) NOT NULL DEFAULT 'pending',
  `attempts` int unsigned NOT NULL DEFAULT 0, `next_at` int unsigned NOT NULL,
  `created_at` int unsigned NOT NULL, `finished_at` int unsigned DEFAULT NULL,
  `error_code` varchar(32) DEFAULT NULL, KEY (`next_at`), KEY (`created_at`), KEY `telegram_notification_due` (`status`,`next_at`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_daily_task_run` (
 `task` varchar(48) NOT NULL, `business_date` date NOT NULL, `timezone` varchar(64) NOT NULL,
 `status` varchar(16) NOT NULL, `updated_at` int unsigned NOT NULL, PRIMARY KEY (`task`,`business_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_daily_user_reset` (
 `user_id` bigint unsigned NOT NULL, `business_date` date NOT NULL, PRIMARY KEY (`user_id`,`business_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_telegram_identity` (
 `telegram_id` bigint NOT NULL PRIMARY KEY, `user_id` bigint unsigned NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_telegram_update` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, `bot_key` char(64) NOT NULL, `update_id` bigint unsigned NOT NULL,
 `payload` mediumtext NULL, `status` varchar(16) NOT NULL DEFAULT 'pending', `attempts` int unsigned NOT NULL DEFAULT 0,
 `next_at` int unsigned NOT NULL DEFAULT 0, `created_at` int unsigned NOT NULL, `error_code` varchar(48) NULL,
 UNIQUE KEY (`bot_key`,`update_id`), KEY (`next_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_telegram_payment_notice` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, `order_id` bigint unsigned NOT NULL, `user_id` bigint unsigned NOT NULL,
 `telegram_id` bigint NOT NULL, `bot_key` char(64) NOT NULL, `status` varchar(16) NOT NULL DEFAULT 'pending',
 `next_at` int unsigned NOT NULL DEFAULT 0, `attempts` int unsigned NOT NULL DEFAULT 0, `created_at` int unsigned NOT NULL,
 `error_code` varchar(48) NULL, UNIQUE KEY (`order_id`,`user_id`), KEY (`next_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_mail_event` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
 `event_key` varchar(64) NOT NULL UNIQUE, `provider` varchar(24) NOT NULL,
 `message_id` varchar(255) NOT NULL, `recipient_hash` varchar(64) NOT NULL,
 `state` varchar(24) NOT NULL, `occurred_at` int unsigned NOT NULL,
 `created_at` int unsigned NOT NULL, `applied_at` int unsigned DEFAULT NULL,
 KEY `mail_event_message` (`provider`,`message_id`), KEY `v2_mail_event_created_at_index` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_mail_suppression` (
 `recipient_hash` varchar(64) NOT NULL PRIMARY KEY, `email` varchar(64) NOT NULL,
 `reason` varchar(24) NOT NULL, `released_at` int unsigned DEFAULT NULL,
 `created_at` int unsigned NOT NULL, `updated_at` int unsigned NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_mail_campaign` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT, `request_key` char(36) NOT NULL, `administrator_id` bigint unsigned NOT NULL, `purpose` varchar(16) NOT NULL,
 `subject` varchar(200) NOT NULL, `content` longtext NOT NULL, `translations` longtext NOT NULL, `source_language` varchar(16) DEFAULT NULL,
 `created_at` int unsigned NOT NULL, `expires_at` int unsigned NOT NULL, PRIMARY KEY (`id`), UNIQUE KEY `mail_campaign_request` (`request_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_mail_campaign_recipient` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT, `campaign_id` bigint unsigned NOT NULL, `user_id` bigint unsigned NOT NULL,
 `recipient_hash` varchar(64) NOT NULL, `status` varchar(16) NOT NULL DEFAULT 'queued', `reason` varchar(40) DEFAULT NULL,
 `mail_log_id` bigint unsigned DEFAULT NULL, `delivery_status` varchar(24) DEFAULT NULL, `scheduled_at` int unsigned NOT NULL DEFAULT 0, `attempts` int unsigned NOT NULL DEFAULT 0, `available_at` int unsigned NOT NULL, `updated_at` int unsigned NOT NULL,
 PRIMARY KEY (`id`), UNIQUE KEY `mail_campaign_user` (`campaign_id`,`user_id`), KEY `mail_campaign_pending` (`status`,`available_at`), KEY `mail_campaign_log` (`mail_log_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_ticket_notification_read` (
 `ticket_id` bigint unsigned NOT NULL, `user_id` bigint unsigned NOT NULL, `message_id` bigint unsigned NOT NULL, `read_at` int unsigned NOT NULL,
 PRIMARY KEY (`ticket_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_mail_blocklist` (
 `recipient_hash` varchar(64) NOT NULL, `email_encrypted` text NOT NULL, `note` varchar(1000) NOT NULL,
 `revision` int unsigned NOT NULL DEFAULT 1, `administrator_id` bigint unsigned NOT NULL,
 `created_at` int unsigned NOT NULL, `updated_at` int unsigned NOT NULL, `released_at` int unsigned DEFAULT NULL,
 PRIMARY KEY (`recipient_hash`), KEY `mail_blocklist_active` (`released_at`,`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_mail_blocklist_audit` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT, `recipient_hash` varchar(64) NOT NULL, `administrator_id` bigint unsigned NOT NULL,
 `action` varchar(16) NOT NULL, `created_at` int unsigned NOT NULL,
 PRIMARY KEY (`id`), KEY `mail_blocklist_history` (`recipient_hash`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_coupon_wallet` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` int unsigned NOT NULL, `coupon_id` int unsigned NOT NULL,
  `snapshot` text NOT NULL, `order_id` int unsigned DEFAULT NULL,
  `administrator_id` int unsigned DEFAULT NULL, `created_at` int unsigned NOT NULL,
  UNIQUE KEY `coupon_wallet_user` (`user_id`,`coupon_id`), UNIQUE KEY `coupon_wallet_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_exchange_rate` (
  `id` int unsigned NOT NULL PRIMARY KEY, `usd_cny_micros` bigint unsigned DEFAULT NULL,
  `quoted_at` int unsigned DEFAULT NULL, `fetched_at` int unsigned DEFAULT NULL,
  `automatic_day` varchar(10) DEFAULT NULL, `attempted_at` int unsigned DEFAULT NULL,
  `last_error` varchar(32) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO `v2_exchange_rate` (`id`) VALUES (1);

CREATE TABLE IF NOT EXISTS `v2_coupon_campaign` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, `preview_key` char(36) NOT NULL,
 `administrator_id` bigint unsigned NOT NULL, `coupon_id` int unsigned NOT NULL,
 `terms` text NOT NULL, `template_hash` varchar(64) NOT NULL, `scope` varchar(16) NOT NULL,
 `status` varchar(16) NOT NULL DEFAULT 'draft', `matched_count` int unsigned NOT NULL,
 `reserved_remaining` int unsigned NOT NULL DEFAULT 0, `limited_stock` tinyint(1) NOT NULL DEFAULT 0,
 `created_at` int unsigned NOT NULL, `expires_at` int unsigned NOT NULL,
 `confirmed_at` int unsigned DEFAULT NULL, `finished_at` int unsigned DEFAULT NULL,
 UNIQUE KEY `coupon_campaign_preview` (`preview_key`), KEY `coupon_campaign_state` (`status`,`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_coupon_campaign_recipient` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, `campaign_id` bigint unsigned NOT NULL,
 `user_id` int unsigned NOT NULL, `status` varchar(16) NOT NULL, `reason` varchar(32) DEFAULT NULL,
 `wallet_id` bigint unsigned DEFAULT NULL, `attempts` int unsigned NOT NULL DEFAULT 0,
 `available_at` int unsigned NOT NULL, `updated_at` int unsigned NOT NULL,
 UNIQUE KEY `coupon_campaign_user` (`campaign_id`,`user_id`), KEY `coupon_campaign_pending` (`status`,`available_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `v2_coupon` ADD COLUMN `activity_title` varchar(120) DEFAULT NULL, ADD COLUMN `activity_description` text DEFAULT NULL, ADD COLUMN `translations` text DEFAULT NULL;

CREATE TABLE IF NOT EXISTS `v2_user_mfa` (
  `user_id` int unsigned NOT NULL,
  `email_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `totp_secret` text DEFAULT NULL,
  `recovery_hashes` text DEFAULT NULL,
  `last_totp_step` bigint NOT NULL DEFAULT -1,
  `version` int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_passkey` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `credential_hash` varchar(64) NOT NULL,
  `credential_id` text NOT NULL,
  `public_key` text NOT NULL,
  `user_handle` varchar(64) NOT NULL,
  `rp_id` varchar(253) NOT NULL,
  `name` varchar(64) NOT NULL,
  `sign_count` bigint unsigned NOT NULL DEFAULT 0,
  `created_at` int unsigned NOT NULL,
  `last_used_at` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `v2_passkey_credential_hash_unique` (`credential_hash`),
  KEY `v2_passkey_user_id_index` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_node_dictionary` (`key` varchar(80) NOT NULL, `names` text NOT NULL, `version` int unsigned NOT NULL DEFAULT 0, `updated_by` int unsigned NOT NULL, `updated_at` bigint unsigned NOT NULL, PRIMARY KEY (`key`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_client_recognition` (`id` int unsigned NOT NULL, `rules` text NOT NULL, `version` int unsigned NOT NULL DEFAULT 0, `updated_by` int unsigned NOT NULL, `updated_at` bigint unsigned NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_node_credential_state` (
  `node_type` varchar(16) NOT NULL,
  `node_id` int unsigned NOT NULL,
  `migrated_at` int unsigned NOT NULL,
  PRIMARY KEY (`node_type`,`node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_node_credential` (
  `id` varchar(32) NOT NULL,
  `node_type` varchar(16) NOT NULL,
  `node_id` int unsigned NOT NULL,
  `secret_hash` varchar(64) NOT NULL,
  `created_at` int unsigned NOT NULL,
  `created_by` int unsigned NOT NULL,
  `last_used_at` int unsigned DEFAULT NULL,
  `expires_at` int unsigned DEFAULT NULL,
  `revoked_at` int unsigned DEFAULT NULL,
  `revoked_by` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `v2_node_credential_node_type_node_id_index` (`node_type`,`node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_node_target_snapshot` (
  `id` varchar(64) NOT NULL,
  `node_id` int unsigned NOT NULL,
  `version` varchar(36) NOT NULL,
  `bucket_at` bigint unsigned NOT NULL,
  `expires_at` bigint unsigned NOT NULL,
  `payload_bytes` int unsigned NOT NULL,
  `daily_archived` tinyint(1) NOT NULL DEFAULT 0,
  `payload` longtext NOT NULL,
  PRIMARY KEY (`id`),
  KEY `node_target_lookup` (`node_id`,`version`,`bucket_at`),
  KEY `v2_node_target_snapshot_expires_at_index` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `v2_node_target_day` (
 `id` varchar(64) NOT NULL PRIMARY KEY, `node_id` int unsigned NOT NULL, `day_at` bigint unsigned NOT NULL,
 `expires_at` bigint unsigned NOT NULL, `target_count` int unsigned NOT NULL DEFAULT 0,
 `omitted` bigint unsigned NOT NULL DEFAULT 0, `source_dropped` bigint unsigned NOT NULL DEFAULT 0,
 `last_bucket_at` bigint unsigned NOT NULL, KEY `target_day_expiry` (`expires_at`), KEY `target_day_lookup` (`node_id`,`day_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_node_target_daily` (
 `id` varchar(64) NOT NULL PRIMARY KEY, `node_id` int unsigned NOT NULL, `day_at` bigint unsigned NOT NULL,
 `type` varchar(8) NOT NULL, `target` varchar(253) NOT NULL, `connections` bigint unsigned NOT NULL,
 `upload_bytes` bigint unsigned NOT NULL, `download_bytes` bigint unsigned NOT NULL, `total_bytes` bigint unsigned NOT NULL,
 `expires_at` bigint unsigned NOT NULL, KEY `target_daily_expiry` (`expires_at`), KEY `target_daily_lookup` (`node_id`,`day_at`,`total_bytes`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `v2_node_maintenance` (
  `type` varchar(16) NOT NULL,
  `node_id` int unsigned NOT NULL,
  `reason` varchar(200) NOT NULL DEFAULT '',
  `hide_subscription` tinyint(1) NOT NULL DEFAULT 0,
  `ends_at` int unsigned NOT NULL,
  `updated_at` int unsigned NOT NULL,
  PRIMARY KEY (`type`, `node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE IF NOT EXISTS `v2_ddns_credential` (
 `id` int unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, `name` varchar(100) NOT NULL, `zone_id` varchar(32) NOT NULL,
 `secret` text NOT NULL, `root_domain` varchar(253) DEFAULT NULL, `next_run` bigint NOT NULL DEFAULT 0, `status` varchar(40) NOT NULL DEFAULT 'ready'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_node_ddns` (
 `id` int unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, `credential_id` int unsigned NOT NULL,
 `node_type` varchar(10) NOT NULL, `node_id` int unsigned NOT NULL, `domain` varchar(253) NOT NULL,
 `family` varchar(8) NOT NULL, `enabled` tinyint(1) NOT NULL DEFAULT 1, `managed` tinyint(1) NOT NULL DEFAULT 0,
 `published_domain` varchar(253) DEFAULT NULL, `report_hash` varchar(64) DEFAULT NULL,
 `ipv4` varchar(45) DEFAULT NULL, `ipv6` varchar(45) DEFAULT NULL,
 `ipv4_seen_at` bigint NOT NULL DEFAULT 0, `ipv6_seen_at` bigint NOT NULL DEFAULT 0,
 `next_run` bigint NOT NULL DEFAULT 0, `last_success` bigint NOT NULL DEFAULT 0, `status` varchar(40) NOT NULL DEFAULT 'awaiting_report',
 UNIQUE KEY `ddns_node` (`node_type`,`node_id`), UNIQUE KEY `ddns_domain` (`domain`), UNIQUE KEY `ddns_report` (`report_hash`),
 KEY `ddns_credential` (`credential_id`), KEY `ddns_next` (`next_run`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_ddns_event` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, `assignment_id` int unsigned NOT NULL,
 `code` varchar(40) NOT NULL, `http_status` smallint unsigned DEFAULT NULL, `created_at` bigint NOT NULL,
 KEY `ddns_event_assignment` (`assignment_id`), KEY `ddns_event_time` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS `v2_node_dns_record` (
 `id` int unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, `assignment_id` int unsigned NOT NULL, `credential_id` int unsigned NOT NULL,
 `domain` varchar(253) NOT NULL, `type` varchar(4) NOT NULL, `record_id` varchar(32) DEFAULT NULL,
 `owner` varchar(64) NOT NULL, `content` varchar(45) DEFAULT NULL, `status` varchar(40) NOT NULL DEFAULT 'pending',
 `delete_after` bigint NOT NULL DEFAULT 0, `next_run` bigint NOT NULL DEFAULT 0,
 UNIQUE KEY `node_dns_identity` (`credential_id`,`domain`,`type`), UNIQUE KEY `node_dns_owner` (`owner`),
 KEY `node_dns_assignment` (`assignment_id`), KEY `node_dns_credential` (`credential_id`), KEY `node_dns_delete` (`delete_after`), KEY `node_dns_next` (`next_run`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
