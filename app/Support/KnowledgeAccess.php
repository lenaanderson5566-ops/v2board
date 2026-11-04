<?php

namespace App\Support;

final class KnowledgeAccess
{
    /** Return null when a malformed marker makes the visibility boundary ambiguous. */
    public static function publicBody(string $body, string $placeholder = ''): ?string
    {
        $public = '';
        $depth = 0;
        $offset = 0;
        $publicStart = 0;
        while (preg_match('/<!--access (start|end)-->/', $body, $match, PREG_OFFSET_CAPTURE, $offset)) {
            [$marker, $position] = $match[0];
            $offset = $position + strlen($marker);
            if ($match[1][0] === 'start') {
                if ($depth === 0) {
                    $public .= substr($body, $publicStart, $position - $publicStart).$placeholder;
                }
                $depth++;
            } else {
                if ($depth === 0) return null;
                $depth--;
                if ($depth === 0) $publicStart = $offset;
            }
        }
        return $depth === 0 ? $public.substr($body, $publicStart) : null;
    }
}
