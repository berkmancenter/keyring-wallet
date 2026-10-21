#!/bin/bash
# bash e2e/gate/ci/rows.test.sh: gate.sh run --rows runs some rows of named legs (one case from the road). A row belongs
# to one leg, so a row with the same name in another leg is never selected there; plain rows need exactly one leg; a
# rows run is never a release gate. No network: the refusals come before the env file is read.
set -u
here=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; fails=0
ok() { echo "ok   $*"; }; bad() { echo "FAIL $*"; fails=$((fails + 1)); }
L() { ( export GATE_HOME=$T/home; . "$here/../lib.sh" >/dev/null 2>&1; "$@" ) 2>&1; echo " rc=$?"; }
[ "$(L rows_spec linkwait link-no-answer)" = "linkwait:link-no-answer rc=0" ] && ok "one leg: plain rows belong to it" || bad "one leg: $(L rows_spec linkwait link-no-answer)"
[ "$(L rows_spec testreq,linkwait 'testreq:a,linkwait:b,linkwait:c')" = "testreq:a,linkwait:b,linkwait:c rc=0" ] && ok "several legs: leg:row pairs are kept" || bad "several legs: $(L rows_spec testreq,linkwait 'testreq:a,linkwait:b,linkwait:c')"
case $(L rows_spec testreq,linkwait a) in *"name its leg"*" rc=1") ok "several legs: a plain row is refused (it could select in either)";; *) bad "plain row with two legs: $(L rows_spec testreq,linkwait a)";; esac
case $(L rows_spec testreq smoke-android:x) in *"not among --legs"*" rc=1") ok "a row of a leg not named is refused";; *) bad "row of an unnamed leg: $(L rows_spec testreq smoke-android:x)";; esac
case $(L rows_spec testreq "") in *"no rows given"*" rc=1") ok "an empty --rows is refused";; *) bad "empty rows: $(L rows_spec testreq '')";; esac
S='testreq:a,linkwait:b,linkwait:c'
[ "$(L rows_for linkwait "$S")" = "b,c rc=0" ] && ok "a leg gets only its own rows" || bad "rows_for linkwait: $(L rows_for linkwait "$S")"
[ "$(L rows_for smoke-android "$S")" = " rc=0" ] && ok "a leg with no rows named gets none (it runs in full)" || bad "rows_for smoke-android: $(L rows_for smoke-android "$S")"
[ "$(L rows_for testreq 'testreq:a,linkwait:a')" = "a rc=0" ] && ok "the same row name in another leg is not selected there" || bad "same-name row: $(L rows_for testreq 'testreq:a,linkwait:a')"
G() { ( export GATE_HOME=$T/home GATE_ENV=$T/none.env; bash "$here/../gate.sh" run "$@" ) 2>&1; echo " rc=$?"; }
case $(G --pin abc --rows x) in *"needs --legs"*" rc=1") ok "gate.sh run --rows without --legs is refused";; *) bad "rows without legs: $(G --pin abc --rows x | tail -1)";; esac
case $(G --pin abc --legs testreq --rows x --kind gate) in *"release gate runs whole legs"*" rc=1") ok "--rows with --kind gate is refused";; *) bad "rows with kind gate: $(G --pin abc --legs testreq --rows x --kind gate | tail -1)";; esac
case $(G --pin abc --legs testreq,linkwait --rows x) in *"not accepted"*" rc=1") ok "gate.sh run refuses an ambiguous plain row";; *) bad "ambiguous row via gate.sh: $(G --pin abc --legs testreq,linkwait --rows x | tail -1)";; esac
case $(G --pin abc --legs testreq --rows x) in *"no $T/none.env"*" rc=1") ok "accepted rows go on to the run (here: stopped at the missing env file)";; *) bad "valid rows: $(G --pin abc --legs testreq --rows x | tail -1)";; esac
grep -q 'echo "scope=ROWS ONLY' "$here/../gate.sh" && grep -q 'echo "rows=$GATE_ROWS"' "$here/../gate.sh" && ok "a rows run writes rows= and a scope= line to its meta (the report prints scope=)" || bad "meta lines missing"
[ $fails = 0 ] && echo "rows: all passed" || { echo "rows: $fails failed"; exit 1; }
