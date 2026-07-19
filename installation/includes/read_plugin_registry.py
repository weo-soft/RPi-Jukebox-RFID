#!/usr/bin/env python3
"""Read plugins from plugin_registry.yaml and print name|description pairs."""
import sys
import os

registry_file = sys.argv[1]
if not os.path.isfile(registry_file):
    sys.exit(0)

with open(registry_file) as f:
    for line in f:
        raw = line
        ls = line.lstrip()
        # Only match uncommented lines (no leading # after stripping)
        if raw.lstrip().startswith('#'):
            continue
        if ls.startswith('- name:'):
            name = ls.split(':', 1)[1].strip()
        elif ls.startswith('description:'):
            desc = ls.split(':', 1)[1].strip().strip('"')
            if name and desc:
                print(f'{name}|{desc}')
                name = ''
                desc = ''