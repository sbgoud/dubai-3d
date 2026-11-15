#!/bin/bash
cd /workspace/dubai-3d
P="Read BRIEF.md in the current folder and complete every step in it fully and autonomously."
for M in opencode/minimax-m3.1-flash-free opencode/deepseek-v4.1-flash-free opencode/minimax-m3.1-flash-free opencode/deepseek-v4.1-flash-free opencode/minimax-m3.1-flash-free opencode/deepseek-v4.1-flash-free; do
  [ -s DEPLOYED_URL.txt ] && break
  echo "=== $M $(date)" >> run.log
  timeout -k 60 90m opencode run -m "$M" "$P" >> run.log 2>&1
  [ -s DEPLOYED_URL.txt ] || P="Read BRIEF.md. Work was started earlier in this folder; inspect current state, continue and finish every step (build passing, GitHub push, Vercel prod deploy, DEPLOYED_URL.txt)."
done
echo "=== END $(date)" >> run.log
