#!/usr/bin/env python3
"""
Anti-Cheat Plotter
Visualizes decision time patterns from processed battle log data.

This script creates plots showing average decision times over time,
useful for detecting suspicious patterns that might indicate cheating.

Usage:
    python anticheat_plot.py --input data.json --output plot.png
"""

import json
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional
import argparse

try:
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
    from matplotlib.figure import Figure
    import numpy as np
except ImportError:
    print("Error: matplotlib and numpy are required. Install with: pip install matplotlib numpy", file=sys.stderr)
    sys.exit(1)


def load_data(input_file: Path) -> Dict[str, List[Dict]]:
    """Load processed battle data from JSON file."""
    with open(input_file, 'r') as f:
        return json.load(f)


def remove_outliers_iqr(data: List[float], factor: float = 1.5) -> List[bool]:
    """
    Identify outliers using IQR method.
    
    Args:
        data: List of values
        factor: IQR multiplier (1.5 = standard, 3.0 = very conservative)
    
    Returns:
        List of booleans indicating which values are NOT outliers (True = keep)
    """
    if len(data) < 4:
        return [True] * len(data)
    
    arr = np.array(data)
    q1 = np.percentile(arr, 25)
    q3 = np.percentile(arr, 75)
    iqr = q3 - q1
    
    lower_bound = q1 - factor * iqr
    upper_bound = q3 + factor * iqr
    
    return [(lower_bound <= x <= upper_bound) for x in data]


def prepare_plot_data(data: Dict[str, List[Dict]], remove_outliers: bool = False) -> Dict[str, tuple]:
    """
    Prepare data for plotting.
    
    Args:
        data: Battle data dictionary
        remove_outliers: If True, filter out outliers using IQR method
    
    Returns:
        Dictionary mapping username -> (timestamps, avg_times)
    """
    plot_data = {}
    
    for username, battles in data.items():
        if not battles:
            continue
        
        # Sort battles by timestamp
        sorted_battles = sorted(battles, key=lambda x: x['battle_timestamp'])
        
        # Extract timestamps and decision times
        timestamps = []
        avg_times = []
        
        for battle in sorted_battles:
            ts = battle['battle_timestamp']
            avg_time = battle['avg_decision_time']
            
            # Convert unix timestamp to datetime
            dt = datetime.fromtimestamp(ts)
            timestamps.append(dt)
            avg_times.append(avg_time)
        
        # Remove outliers if requested
        if remove_outliers and len(avg_times) > 3:
            keep_mask = remove_outliers_iqr(avg_times)
            timestamps = [t for t, keep in zip(timestamps, keep_mask) if keep]
            avg_times = [v for v, keep in zip(avg_times, keep_mask) if keep]
        
        plot_data[username] = (timestamps, avg_times)
    
    return plot_data


def create_plot(
    plot_data: Dict[str, tuple],
    title: str = "Player Decision Times Over Time",
    output_file: Optional[Path] = None,
    figsize: tuple = (14, 8),
    show_grid: bool = True,
    show_stats: bool = True,
    moving_average_window: int = 0
) -> Figure:
    """
    Create a plot of decision times over time for multiple players.
    
    Args:
        plot_data: Dictionary mapping username -> (timestamps, avg_times)
        title: Plot title
        output_file: Optional output file path
        figsize: Figure size (width, height) in inches
        show_grid: Whether to show grid lines
        show_stats: Whether to show statistics in legend
    """
    fig, ax = plt.subplots(figsize=figsize)
    
    # Color palette for different players
    colors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', 
              '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf']
    
    # Plot each player's data
    for idx, (username, (timestamps, avg_times)) in enumerate(plot_data.items()):
        color = colors[idx % len(colors)]
        
        # Calculate statistics
        avg = sum(avg_times) / len(avg_times) if avg_times else 0
        min_time = min(avg_times) if avg_times else 0
        max_time = max(avg_times) if avg_times else 0
        
        # Create label with stats if requested
        if show_stats:
            label = f"{username} (avg: {avg:.2f}s, n={len(avg_times)})"
        else:
            label = username
        
        # Plot raw data points
        if moving_average_window > 0:
            # Show raw data as lighter scatter points
            ax.scatter(timestamps, avg_times, color=color, alpha=0.2, s=15, zorder=1)
            
            # Calculate and plot moving average
            if len(avg_times) >= moving_average_window:
                ma_times = []
                ma_timestamps = []
                
                for i in range(len(avg_times)):
                    start = max(0, i - moving_average_window // 2)
                    end = min(len(avg_times), i + moving_average_window // 2 + 1)
                    window_avg = sum(avg_times[start:end]) / (end - start)
                    ma_times.append(window_avg)
                    ma_timestamps.append(timestamps[i])
                
                ax.plot(ma_timestamps, ma_times, '-', label=label, color=color, 
                       linewidth=2.5, alpha=0.9, zorder=2)
            else:
                # Not enough data for moving average, plot normally
                ax.plot(timestamps, avg_times, 'o-', label=label, color=color, 
                       alpha=0.7, markersize=4, linewidth=1.5)
        else:
            # Plot normal line with markers
            ax.plot(timestamps, avg_times, 'o-', label=label, color=color, 
                   alpha=0.7, markersize=4, linewidth=1.5)
        
        # Add a horizontal line for the mean
        if timestamps and moving_average_window == 0:
            ax.axhline(y=avg, color=color, linestyle='--', alpha=0.3, linewidth=1)
    
    # Formatting
    ax.set_xlabel('Battle Date/Time', fontsize=12, fontweight='bold')
    ax.set_ylabel('Average Decision Time (seconds)', fontsize=12, fontweight='bold')
    ax.set_title(title, fontsize=14, fontweight='bold', pad=20)
    
    # Format x-axis to show dates nicely
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
    ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    fig.autofmt_xdate()  # Rotate date labels
    
    # Grid
    if show_grid:
        ax.grid(True, alpha=0.3, linestyle='--', linewidth=0.5)
    
    # Legend
    ax.legend(loc='best', fontsize=10, framealpha=0.9)
    
    # Tight layout
    plt.tight_layout()
    
    # Save if output file specified
    if output_file:
        plt.savefig(output_file, dpi=300, bbox_inches='tight')
        print(f"Plot saved to: {output_file}")
    
    return fig


def create_statistical_summary(data: Dict[str, List[Dict]]) -> str:
    """Generate a textual statistical summary."""
    lines = []
    lines.append("=" * 80)
    lines.append("STATISTICAL SUMMARY")
    lines.append("=" * 80)
    
    for username, battles in data.items():
        if not battles:
            continue
        
        avg_times = [b['avg_decision_time'] for b in battles]
        turns_list = [b['turns'] for b in battles]
        wins = sum(1 for b in battles if b.get('winner', '').lower() == username.lower())
        
        lines.append(f"\nPlayer: {username}")
        lines.append(f"  Total battles (vs PAC-MM* bots): {len(battles)}")
        lines.append(f"  Win rate: {wins}/{len(battles)} ({100*wins/len(battles):.1f}%)")
        lines.append(f"  Average decision time: {sum(avg_times)/len(avg_times):.2f}s")
        lines.append(f"  Min decision time: {min(avg_times):.2f}s")
        lines.append(f"  Max decision time: {max(avg_times):.2f}s")
        lines.append(f"  Median decision time: {sorted(avg_times)[len(avg_times)//2]:.2f}s")
        lines.append(f"  Average turns per battle: {sum(turns_list)/len(turns_list):.1f}")
        
        # Time range
        timestamps = [b['battle_timestamp'] for b in battles]
        start_time = datetime.fromtimestamp(min(timestamps))
        end_time = datetime.fromtimestamp(max(timestamps))
        lines.append(f"  Time range: {start_time.strftime('%Y-%m-%d')} to {end_time.strftime('%Y-%m-%d')}")
    
    lines.append("=" * 80)
    return '\n'.join(lines)


def create_detailed_plot(
    plot_data: Dict[str, tuple],
    data: Dict[str, List[Dict]],
    output_prefix: str
) -> None:
    """Create multiple detailed plots with different views."""
    
    # 1. Main time series plot
    create_plot(
        plot_data,
        title="Player Decision Times Over Time (vs PAC-MM* Bots)",
        output_file=Path(f"{output_prefix}_timeseries.png"),
        show_stats=True
    )
    
    # 2. Distribution plot (histogram)
    fig, axes = plt.subplots(1, len(data), figsize=(6*len(data), 5))
    if len(data) == 1:
        axes = [axes]
    
    for idx, (username, battles) in enumerate(data.items()):
        avg_times = [b['avg_decision_time'] for b in battles]
        
        axes[idx].hist(avg_times, bins=20, alpha=0.7, edgecolor='black')
        axes[idx].axvline(sum(avg_times)/len(avg_times), color='red', 
                         linestyle='--', linewidth=2, label=f'Mean: {sum(avg_times)/len(avg_times):.2f}s')
        axes[idx].set_xlabel('Average Decision Time (seconds)', fontweight='bold')
        axes[idx].set_ylabel('Frequency', fontweight='bold')
        axes[idx].set_title(f'{username}\nDecision Time Distribution', fontweight='bold')
        axes[idx].legend()
        axes[idx].grid(True, alpha=0.3)
    
    plt.tight_layout()
    plt.savefig(f"{output_prefix}_distribution.png", dpi=300, bbox_inches='tight')
    print(f"Distribution plot saved to: {output_prefix}_distribution.png")
    plt.close()
    
    # 3. Moving average plot (smoothed)
    fig, ax = plt.subplots(figsize=(14, 8))
    colors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd']
    
    for idx, (username, (timestamps, avg_times)) in enumerate(plot_data.items()):
        color = colors[idx % len(colors)]
        
        # Calculate moving average (window of 5)
        window = min(5, len(avg_times))
        if window > 1:
            smoothed = []
            for i in range(len(avg_times)):
                start = max(0, i - window // 2)
                end = min(len(avg_times), i + window // 2 + 1)
                smoothed.append(sum(avg_times[start:end]) / (end - start))
        else:
            smoothed = avg_times
        
        # Plot raw data as scatter
        ax.scatter(timestamps, avg_times, alpha=0.3, s=20, color=color)
        
        # Plot smoothed line
        ax.plot(timestamps, smoothed, '-', label=f"{username} (smoothed)", 
               color=color, linewidth=2.5, alpha=0.8)
    
    ax.set_xlabel('Battle Date/Time', fontsize=12, fontweight='bold')
    ax.set_ylabel('Average Decision Time (seconds)', fontsize=12, fontweight='bold')
    ax.set_title('Smoothed Decision Times (5-game moving average)', 
                fontsize=14, fontweight='bold', pad=20)
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
    fig.autofmt_xdate()
    ax.grid(True, alpha=0.3, linestyle='--', linewidth=0.5)
    ax.legend(loc='best', fontsize=10, framealpha=0.9)
    plt.tight_layout()
    plt.savefig(f"{output_prefix}_smoothed.png", dpi=300, bbox_inches='tight')
    print(f"Smoothed plot saved to: {output_prefix}_smoothed.png")
    plt.close()


def main():
    parser = argparse.ArgumentParser(
        description='Visualize anti-cheat decision time data'
    )
    parser.add_argument(
        '--input', '-i',
        required=True,
        help='Input JSON file from anticheat_process_logs.py'
    )
    parser.add_argument(
        '--output', '-o',
        required=True,
        help='Output plot file path (e.g., plot.png)'
    )
    parser.add_argument(
        '--title',
        default='Player Decision Times Over Time (vs PAC-MM* Bots)',
        help='Plot title'
    )
    parser.add_argument(
        '--detailed',
        action='store_true',
        help='Generate multiple detailed plots'
    )
    parser.add_argument(
        '--stats',
        action='store_true',
        help='Print statistical summary'
    )
    parser.add_argument(
        '--no-show',
        action='store_true',
        help='Do not display plot interactively'
    )
    parser.add_argument(
        '--moving-average',
        type=int,
        default=0,
        help='Window size for moving average (0 = disabled, e.g., 50 for 50-game MA)'
    )
    parser.add_argument(
        '--remove-outliers',
        action='store_true',
        help='Remove outliers using IQR method before plotting'
    )
    parser.add_argument(
        '--exclude',
        nargs='*',
        default=[],
        help='Usernames to exclude from the plot (case-insensitive)'
    )
    
    args = parser.parse_args()
    
    # Load data
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)
    
    data = load_data(input_path)
    
    if not data:
        print("Error: No data found in input file", file=sys.stderr)
        sys.exit(1)
    
    # Filter out excluded usernames
    if args.exclude:
        excluded_lower = [name.lower() for name in args.exclude]
        original_count = len(data)
        data = {username: battles for username, battles in data.items() 
                if username.lower() not in excluded_lower}
        excluded_count = original_count - len(data)
        if excluded_count > 0:
            print(f"Excluded {excluded_count} username(s) from visualization")
    
    # Prepare plot data
    plot_data = prepare_plot_data(data, remove_outliers=args.remove_outliers)
    
    if args.remove_outliers:
        print("Outliers removed using IQR method (factor=1.5)")
    
    # Print statistics if requested
    if args.stats:
        summary = create_statistical_summary(data)
        print(summary)
    
    # Create plots
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    if args.detailed:
        # Create multiple detailed plots
        output_prefix = output_path.stem
        output_dir = output_path.parent
        prefix = str(output_dir / output_prefix)
        create_detailed_plot(plot_data, data, prefix)
    else:
        # Create single plot
        create_plot(plot_data, title=args.title, output_file=output_path, 
                   moving_average_window=args.moving_average)
    
    # Show plot interactively if requested
    if not args.no_show:
        plt.show()


if __name__ == '__main__':
    main()

