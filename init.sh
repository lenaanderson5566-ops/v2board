#!/bin/bash

rm -rf composer.phar
wget https://github.com/composer/composer/releases/latest/download/composer.phar -O composer.phar
php composer.phar install -vvv

php artisan fastai:install

if [ -f "/etc/init.d/bt" ]; then
  chown -R www $(pwd);
fi
