        :root {
            --bg: #f6f8fb;
            --card: #ffffff;
            --text: #1f2937;
            --muted: #6b7280;
            --border: #e5e7eb;
            --primary: #2563eb;
            --primary-soft: #eff6ff;
            --success: #16a34a;
            --danger: #dc2626;
        }
        * { box-sizing: border-box; }
        html { height: 100%; overflow-y: scroll; }
        body { font-family: Arial, sans-serif; margin: 0; background: var(--bg); color: var(--text); min-height: 100%; }

        .layout { display: flex; min-height: 100vh; }
        .sidebar {
            width: 240px;
            flex: 0 0 240px;
            background: #111827;
            color: #e5e7eb;
            padding: 20px 16px;
            border-right: 1px solid #1f2937;
        }
        .menu-section { margin-bottom: 12px; }
        .menu-group-title { font-size:11px; color:#9ca3af; margin:0 0 8px; letter-spacing:.4px; text-transform:uppercase; }
        .menu-list { display: flex; flex-direction: column; gap: 8px; }
        .menu-btn {
            width: 100%;
            text-align: left;
            border: 1px solid #374151;
            background: #1f2937;
            color: #e5e7eb;
            border-radius: 8px;
            padding: 9px 10px;
            font-size: 12px;
            line-height: 1.2;
            height: 36px;
            min-height: 36px;
            max-height: 36px;
            display: flex;
            align-items: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-weight: 400;
            cursor: pointer;
        }
        .menu-btn:hover { background: #2563eb; border-color: #2563eb; }
        .menu-btn.active { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 400; }

        .content { flex: 1; padding: 16px; }
        .container { max-width: 1680px; margin: 0 auto; }
        .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
        .title { margin: 0; font-size: 24px; }
        .status { padding: 10px 12px; border-radius: 8px; font-size: 13px; border: 1px solid var(--border); background: var(--card); margin-bottom: 14px; }
        .status.ok { color: var(--success); border-color: #bbf7d0; background: #f0fdf4; }
        .status.warn { color: var(--danger); border-color: #fecaca; background: #fef2f2; }

        button {
            padding: 7px 12px;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: #fff;
            color: var(--text);
            cursor: pointer;
            font-size: 12px;
        }
        button:hover { border-color: #bfdbfe; background: var(--primary-soft); }

        .result-panel { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 14px; min-height: 360px; }
        .cards { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 12px; margin-top: 12px; }
        .card { border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: #fafafa; }
        .card .label { color: var(--muted); font-size: 12px; }
        .card .value { font-size: 18px; font-weight: bold; margin-top: 6px; }

        table { width: 100%; border-collapse: collapse; margin-top: 12px; background: #fff; }
        th, td { border: 1px solid var(--border); padding: 8px; text-align: left; font-size: 12px; vertical-align: top; }
        th { background: #f9fafb; position: sticky; top: 0; }
        .table-wrap { max-height: 78vh; overflow: auto; border: 1px solid var(--border); border-radius: 8px; }
        .pager { display: flex; gap: 8px; align-items: center; margin: 10px 0 2px; }
        .pager .muted { color: #6b7280; font-size: 12px; }

        .rule-input, .rule-select, .rule-textarea { width: 100%; box-sizing: border-box; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; padding: 6px; }
        .rule-textarea { min-height: 72px; }
        .risk-badge { display:inline-flex; align-items:center; justify-content:center; min-width:52px; border-radius:999px; padding:2px 8px; font-size:11px; font-weight:700; border:1px solid transparent; }
        .risk-badge.high { color:#991b1b; background:#fee2e2; border-color:#fecaca; }
        .risk-badge.medium { color:#92400e; background:#fef3c7; border-color:#fde68a; }
        .risk-badge.low { color:#166534; background:#dcfce7; border-color:#bbf7d0; }
        .kv-list { margin:0; padding-left:16px; color:#4b5563; line-height:1.55; }
        .payload-pre { margin:0; white-space:pre-wrap; word-break:break-word; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; line-height:1.4; color:#374151; }

        @media (max-width: 1100px) {
            .layout { flex-direction: column; }
            .sidebar { width: 100%; border-right: 0; border-bottom: 1px solid #1f2937; }
            .cards { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
        }
    
