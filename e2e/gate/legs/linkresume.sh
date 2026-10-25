#!/bin/bash
# linkresume joined linkwait (gate efficiency item 4): its two cases, a force-stop before and after the grant, run in
# linkwait's loop on the same emulator, and no gate runs this leg any more. Kept only so `gate.sh rerun <run>
# --only-failed` of a run from before the merge still finds the leg it names: it runs those two cases through linkwait.
LINK_CASES=${LINK_CASES:-link-address-resume link-address-resume-later} exec "$(dirname "$0")/linkwait.sh" "$@"
