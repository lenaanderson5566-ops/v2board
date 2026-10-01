<?php
namespace App\Utils;
class Csv
{
    public static function response(array $headers, array $rows, string $filename)
    {
        $stream = fopen('php://temp', 'r+');
        fwrite($stream, "\xEF\xBB\xBF");
        foreach (array_merge([$headers], $rows) as $row) {
            fputcsv($stream, array_map(function ($value) {
                $value = (string) $value;
                return preg_match('/^[=+@\-\t\r]/', $value) ? "'" . $value : $value;
            }, $row), ',', '"', '');
        }
        rewind($stream);
        $content = stream_get_contents($stream);
        fclose($stream);
        return response($content, 200, ['Content-Type' => 'text/csv; charset=UTF-8', 'Content-Disposition' => 'attachment; filename="' . $filename . '"']);
    }
}
