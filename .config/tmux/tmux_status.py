#!/usr/bin/env python3
import shutil
import time
import os

def get_cpu_usage():
    # Reads /proc/stat to calculate CPU usage over a 0.1s interval
    def read_stats():
        with open('/proc/stat', 'r') as f:
            lines = f.readlines()
        for line in lines:
            if line.startswith('cpu '):
                parts = [int(x) for x in line.split()[1:]]
                return sum(parts), parts[3] # (Total, Idle)
        return 0, 0

    t1, i1 = read_stats()
    time.sleep(0.1)
    t2, i2 = read_stats()
    
    total_diff = t2 - t1
    idle_diff = i2 - i1
    return 100 * (total_diff - idle_diff) / total_diff if total_diff > 0 else 0

def get_mem_usage():
    # Reads /proc/meminfo for memory stats
    mem = {}
    with open('/proc/meminfo', 'r') as f:
        for line in f:
            parts = line.split()
            mem[parts[0].replace(':', '')] = int(parts[1])
            
    total = mem['MemTotal'] / 1024 / 1024 # Convert KB to GB
    available = mem.get('MemAvailable', mem.get('MemFree')) / 1024 / 1024
    used = total - available
    percent = (used / total) * 100
    return used, total, percent

def get_color(percent, threshold=80):
    return "#[fg=red,bold]" if percent >= threshold else "#[fg=white,nobold]"

def main():
    # CPU
    cpu_pct = get_cpu_usage()
    cpu_color = get_color(cpu_pct)

    # Disk
    disk = shutil.disk_usage("/")
    disk_total = disk.total / (1024**3)
    disk_used = disk.used / (1024**3)
    disk_pct = (disk.used / disk.total) * 100
    disk_color = get_color(disk_pct)

    # Memory
    mem_used, mem_total, mem_pct = get_mem_usage()
    mem_color = get_color(mem_pct)

    # Formatting
    bullet = "#[fg=colour244] • "
    
    res = (
        f"{cpu_color}CPU {cpu_pct:.0f}%{bullet}"
        f"{disk_color}Disk {disk_used:.0f}G ({disk_pct:.0f}%) of {disk_total:.0f}G{bullet}"
        f"{mem_color}MEM {mem_used:.1f}G ({mem_pct:.0f}%) of {mem_total:.0f}G"
    )
    print(res)

if __name__ == "__main__":
    main()
