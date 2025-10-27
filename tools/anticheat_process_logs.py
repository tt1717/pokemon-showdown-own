#!/usr/bin/env python3
"""
Anti-Cheat Log Processor
Extracts decision time data from Pokemon Showdown battle logs.

This script processes battle logs to calculate average decision times for players.
It filters for battles against PAC-MM* bot opponents where decision speeds are known,
allowing us to isolate the target player's decision times.

SAFETY GUARANTEE:
This script operates in READ-ONLY mode for all log files. It will never modify,
delete, or alter any battle log files. The only write operation is creating the
output JSON file with analysis results.

Usage:
    python anticheat_process_logs.py --username <player> --format gen1ou --start 2025-10-01 --end 2025-10-15 --output data.json
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Dict, List, Tuple, Optional
import argparse


def parse_timestamp_from_log_line(line: str) -> Optional[int]:
    """Extract unix timestamp from log line like '|t:|1759276763'"""
    if line.startswith('|t:|'):
        try:
            return int(line.split('|t:|')[1])
        except (IndexError, ValueError):
            return None
    return None


def extract_timestamps_from_log(log: List[str]) -> List[int]:
    """Extract all timestamps from a battle log."""
    timestamps = []
    for line in log:
        ts = parse_timestamp_from_log_line(line)
        if ts is not None:
            timestamps.append(ts)
    return timestamps


def calculate_average_decision_time(timestamps: List[int]) -> Optional[float]:
    """
    Calculate average time between turns in seconds.
    Returns None if insufficient data.
    """
    if len(timestamps) < 2:
        return None
    
    # Calculate time differences between consecutive timestamps
    differences = []
    for i in range(1, len(timestamps)):
        diff = timestamps[i] - timestamps[i-1]
        # Filter out obviously bad data (negative times, or >5 minutes between turns)
        if 0 < diff < 300:  # 5 minutes max
            differences.append(diff)
    
    if not differences:
        return None
    
    return sum(differences) / len(differences)


def is_pac_mm_bot(username: str) -> bool:
    """Check if username is a PAC-MM* bot."""
    return username.lower().startswith('pac-mm')


def process_battle_log(log_file: Path, target_usernames: List[str]) -> Optional[Dict]:
    """
    Process a single battle log file.
    Returns battle data if it matches criteria, None otherwise.
    
    SAFETY: This function only reads log files and never modifies or deletes them.
    All file operations are read-only.
    """
    try:
        # SAFETY: Open in read-only mode ('r') - cannot modify or delete the file
        with open(log_file, 'r') as f:
            data = json.load(f)
        
        p1 = data.get('p1', '').lower()
        p2 = data.get('p2', '').lower()
        log = data.get('log', [])
        
        # Check if any target username is in this battle
        target_in_battle = None
        opponent = None
        
        for target in target_usernames:
            target_lower = target.lower()
            if target_lower == p1:
                target_in_battle = data['p1']
                opponent = data['p2']
                break
            elif target_lower == p2:
                target_in_battle = data['p2']
                opponent = data['p1']
                break
        
        if not target_in_battle:
            return None
        
        # Check if opponent is a PAC-MM* bot
        if not is_pac_mm_bot(opponent):
            return None
        
        # Extract timestamps and calculate average decision time
        timestamps = extract_timestamps_from_log(log)
        avg_time = calculate_average_decision_time(timestamps)
        
        if avg_time is None:
            return None
        
        # Get battle start time
        battle_timestamp = data.get('timestamp')
        if not battle_timestamp:
            # Try to use first timestamp from log
            if timestamps:
                battle_timestamp = timestamps[0]
            else:
                return None
        else:
            # Parse timestamp string if needed
            if isinstance(battle_timestamp, str):
                try:
                    dt = datetime.strptime(battle_timestamp, '%a %b %d %Y %H:%M:%S GMT%z (Coordinated Universal Time)')
                    battle_timestamp = int(dt.timestamp())
                except:
                    if timestamps:
                        battle_timestamp = timestamps[0]
                    else:
                        return None
        
        turns = data.get('turns', 0)
        winner = data.get('winner', '')
        
        return {
            'username': target_in_battle,
            'opponent': opponent,
            'avg_decision_time': avg_time,
            'battle_timestamp': battle_timestamp,
            'turns': turns,
            'winner': winner,
            'battle_id': log_file.stem,
            'log_file': str(log_file)
        }
        
    except Exception as e:
        print(f"Error processing {log_file}: {e}", file=sys.stderr)
        return None


def date_range_iterator(start_date: str, end_date: str):
    """
    Yield dates between start and end (inclusive) in YYYY-MM-DD format.
    Also yields the YYYY-MM part for directory structure.
    
    Returns tuples of (YYYY-MM, YYYY-MM-DD)
    """
    start = datetime.strptime(start_date, '%Y-%m-%d')
    end = datetime.strptime(end_date, '%Y-%m-%d')
    
    current = start
    while current <= end:
        year_month = current.strftime('%Y-%m')
        full_date = current.strftime('%Y-%m-%d')
        yield year_month, full_date
        current += timedelta(days=1)


def process_logs(
    logs_dir: Path,
    format_id: str,
    target_usernames: List[str],
    start_date: str,
    end_date: str,
    verbose: bool = False
) -> Dict[str, List[Dict]]:
    """
    Process all battle logs for target usernames in the given date range.
    
    Returns:
        Dictionary mapping username -> list of battle data
    """
    results = defaultdict(list)
    total_processed = 0
    total_matched = 0
    
    # Iterate through date range
    # Structure: logs/YYYY-MM/format/YYYY-MM-DD/
    for year_month, date_str in date_range_iterator(start_date, end_date):
        date_dir = logs_dir / year_month / format_id / date_str
        
        if not date_dir.exists():
            if verbose:
                print(f"Directory not found: {date_dir}")
            continue
        
        # Process all log files in this date directory
        log_files = list(date_dir.glob('*.log.json'))
        
        if verbose:
            print(f"Processing {len(log_files)} files from {date_str}...")
        
        for log_file in log_files:
            total_processed += 1
            battle_data = process_battle_log(log_file, target_usernames)
            
            if battle_data:
                results[battle_data['username']].append(battle_data)
                total_matched += 1
                
                # Show first few matches as sanity check
                if verbose and total_matched <= 3:
                    print(f"  ✓ Match #{total_matched}: {battle_data['username']} vs {battle_data['opponent']}")
                    print(f"    Battle: {battle_data['battle_id']}, Avg time: {battle_data['avg_decision_time']:.2f}s, Turns: {battle_data['turns']}")
                
                if verbose and total_matched % 10 == 0 and total_matched > 3:
                    print(f"  Found {total_matched} matching battles so far...")
    
    if verbose:
        print(f"\nProcessing complete:")
        print(f"  Total files processed: {total_processed}")
        print(f"  Matching battles found: {total_matched}")
        for username, battles in results.items():
            # Count unique opponents
            opponents = {}
            for battle in battles:
                opp = battle['opponent']
                opponents[opp] = opponents.get(opp, 0) + 1
            
            print(f"  {username}: {len(battles)} battles")
            if battles and len(opponents) <= 5:
                for opp, count in sorted(opponents.items(), key=lambda x: -x[1]):
                    print(f"    vs {opp}: {count} battles")
            elif battles:
                print(f"    vs {len(opponents)} different PAC-MM* bots")
    
    return dict(results)


def main():
    parser = argparse.ArgumentParser(
        description='Process Pokemon Showdown battle logs for anti-cheat analysis'
    )
    parser.add_argument(
        '--username', '-u',
        nargs='+',
        required=True,
        help='Target username(s) to analyze'
    )
    parser.add_argument(
        '--format', '-f',
        default='gen1ou',
        help='Battle format (default: gen1ou)'
    )
    parser.add_argument(
        '--start',
        required=True,
        help='Start date (YYYY-MM-DD)'
    )
    parser.add_argument(
        '--end',
        required=True,
        help='End date (YYYY-MM-DD)'
    )
    parser.add_argument(
        '--logs-dir',
        default='../logs',
        help='Path to logs directory (default: ../logs from tools dir)'
    )
    parser.add_argument(
        '--output', '-o',
        required=True,
        help='Output JSON file path'
    )
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Verbose output'
    )
    
    args = parser.parse_args()
    
    # Validate dates
    try:
        datetime.strptime(args.start, '%Y-%m-%d')
        datetime.strptime(args.end, '%Y-%m-%d')
    except ValueError as e:
        print(f"Error: Invalid date format. Use YYYY-MM-DD. {e}", file=sys.stderr)
        sys.exit(1)
    
    logs_dir = Path(args.logs_dir)
    if not logs_dir.exists():
        print(f"Error: Logs directory not found: {logs_dir}", file=sys.stderr)
        sys.exit(1)
    
    # Process logs
    print(f"Processing logs for: {', '.join(args.username)}")
    print(f"Format: {args.format}")
    print(f"Date range: {args.start} to {args.end}")
    print(f"Filtering for battles vs PAC-MM* bots\n")
    
    results = process_logs(
        logs_dir=logs_dir,
        format_id=args.format,
        target_usernames=args.username,
        start_date=args.start,
        end_date=args.end,
        verbose=args.verbose
    )
    
    # Save results
    output_path = Path(args.output)
    
    # Sanity check: ensure output path is not in logs directory
    if 'logs' in output_path.parts:
        print("ERROR: Output file cannot be in the logs directory!", file=sys.stderr)
        print(f"Attempted path: {output_path}", file=sys.stderr)
        print("This is a safety measure to prevent accidental log file overwrites.", file=sys.stderr)
        sys.exit(1)
    
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Write output file (this is the ONLY write operation in this script)
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\nResults saved to: {output_path}")
    print(f"Total users analyzed: {len(results)}")
    for username, battles in results.items():
        if battles:
            avg_times = [b['avg_decision_time'] for b in battles]
            overall_avg = sum(avg_times) / len(avg_times)
            print(f"  {username}: {len(battles)} battles, avg decision time: {overall_avg:.2f}s")


if __name__ == '__main__':
    main()

