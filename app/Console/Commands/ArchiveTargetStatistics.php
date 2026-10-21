<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use App\Services\TargetStatisticsArchive;
final class ArchiveTargetStatistics extends Command {
    protected $signature='nodes:archive-targets';
    protected $description='Persist completed target statistics buckets and prune expired snapshots';
    public function handle(TargetStatisticsArchive $archive): int {
        try { $result=$archive->flush(); }
        catch (\Throwable $e) {
            // Database exception bindings can include domains; keep console output generic.
            $this->error('Target statistics archive failed; Redis data retained for retry');
            return 1;
        }
        if (!$result['ready']) { $this->error('Target statistics schema unavailable'); return 1; }
        $this->info('Archived '.$result['savedBuckets'].' buckets; pruned '.$result['prunedBuckets']);
        return 0;
    }
}
