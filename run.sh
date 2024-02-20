#!/usr/bin/env bash

# Get _this_ script's path, so we can use absolute paths for run.py
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
PYTHON3=$(which python3)
RUNPY="$SCRIPT_DIR/src/run.py"
IMGSUM="$SCRIPT_DIR/src/img-summary.py"
LEAP_PROMPT="$SCRIPT_DIR/src/implement_it.txt"
OPENAI_API_KEY="OPENAI API KEY HERE"

PYTHON3=$PYTHON3 RUNPY=$RUNPY IMGSUM=$IMGSUM LEAP_PROMPT=$LEAP_PROMPT OPENAI_API_KEY=$OPENAI_API_KEY scripts/code.sh
