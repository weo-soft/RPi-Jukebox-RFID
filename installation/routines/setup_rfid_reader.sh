#!/usr/bin/env bash

_run_setup_rfid_reader() {
    local script="${INSTALLATION_PATH}"/installation/components/setup_rfid_reader.sh
    local args=()

    # Non-interactive: forward the selected reader module so that
    # run_register_rfid_reader.py does not present the reader menu. Readers
    # without automatic defaults (e.g. generic_usb) still prompt for their
    # customization in a terminal, or abort with a clear error when no
    # terminal is available. In interactive mode the module is chosen later
    # inside the tool itself (no args -> interactive).
    if [[ "${NON_INTERACTIVE:-}" == "true" ]]; then
        if [[ -n "${RFID_READER_MODULE}" ]]; then
            args+=(--reader "${RFID_READER_MODULE}" --deps auto --force)
        else
            log "ERROR: ENABLE_RFID_READER=true but RFID_READER_MODULE is empty"
            exit_on_error "RFID reader is enabled but no reader module was selected."
        fi
    fi

    sudo chmod +x "$script"
    # run_and_print_lc propagates the tool's exit code (see install-jukebox.sh).
    # A failing reader configuration must abort the installation instead of
    # silently continuing with an unconfigured reader (broken daemon startup).
    if [[ "${#args[@]}" -gt 0 ]]; then
        run_and_print_lc "$script" "${args[@]}" \
            || exit_on_error "RFID reader configuration failed. See the install log for details."
    else
        run_and_print_lc "$script" \
            || exit_on_error "RFID reader configuration failed. See the install log for details."
    fi
}

setup_rfid_reader() {
    if [ "$ENABLE_RFID_READER" == true ] ; then
        run_with_log_frame _run_setup_rfid_reader "Install RFID Reader"
    fi
}
