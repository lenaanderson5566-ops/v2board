<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use Symfony\Component\Yaml\Yaml;
use Symfony\Component\Process\Process;
class CheckClientConfigs extends Command
{
 protected $signature='clients:check-configs {--sing-box= : Absolute path to sing-box} {--mihomo= : Absolute path to mihomo}';
 protected $description='Validate generated sample client configurations without changing live templates';
 public function handle() {
  $user=['uuid'=>'00000000-0000-4000-8000-000000000001','u'=>0,'d'=>0,'transfer_enable'=>1073741824,'expired_at'=>time()+86400];
  $nodes=[['name'=>'Validation node','type'=>'shadowsocks','cipher'=>'aes-128-gcm','host'=>'example.com','port'=>443]];
  $failed=false;$incomplete=false;
  foreach(['mihomo'=>'ClashMeta','sing-box'=>'Singbox'] as $engine=>$protocol){
   $file=null;
   try{
    $class='App\\Protocols\\'.$protocol;
    $response=(new $class($user,$nodes))->handle();
    $text=is_string($response)?$response:$response->getContent();
    $config=$engine==='mihomo'?Yaml::parse($text):json_decode($text,true,512,JSON_THROW_ON_ERROR);
    $items=$config[$engine==='mihomo'?'proxy-groups':'outbounds']??null;
    if(!is_array($items) || !$items)throw new \RuntimeException('Missing groups/outbounds');
    $field=$engine==='mihomo'?'name':'tag';$names=array_column($items,$field);
    if(count($names)!==count(array_unique($names)))throw new \RuntimeException('Duplicate names/tags');
    $this->info($engine.': generated sample structure OK');
    $binary=$this->option($engine);
    if(!$binary){$this->warn($engine.': native validation NOT RUN; provide --'.$engine.'=/absolute/path');$incomplete=true;continue;}
    if(!is_file($binary) || !is_executable($binary))throw new \RuntimeException('Core executable not available');
    $file=tempnam(sys_get_temp_dir(),'client-check-');file_put_contents($file,$text);
    $process=new Process($engine==='mihomo'?[$binary,'-t','-f',$file]:[$binary,'check','-c',$file]);$process->setTimeout(45);$process->run();
    if(!$process->isSuccessful())throw new \RuntimeException($process->getErrorOutput().$process->getOutput());
    $this->info($engine.': native validation OK');
   }catch(\Throwable $e){$failed=true;$this->error($engine.': '.$e->getMessage());}
   finally{if($file && is_file($file))unlink($file);}
  }
  return $failed?1:($incomplete?2:0);
 }
}
