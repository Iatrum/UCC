# Task 570: next step after 385d
Plan state: 385a-c done; 385d repo side done (Task 556, review 557 approved); 385e is a decision (second VPS), nothing to build. Remaining 385d items need the real host (Traefik, ufw, sshd, DOCKER-USER) and stay manual runbook steps.
Chosen safe step: a read-only audit kit for plan 1.2/1.3 so the operator gets a pass/fail instead of eyeballing output. Pure text parsers + CLI, no commands run, no network.
Docs read: Compose `ports` short/long syntax (host IP, `[::1]` brackets, container-only = ephemeral port on all interfaces, `host_ip` default 0.0.0.0, `network_mode: host`): https://docs.docker.com/reference/compose-file/services/#ports
Not verified against the real thing: exact `docker ps` / `ss` / `nmap -oG` output on the VPS (parsers follow the common formats and fail closed on unparseable lines); never run on the host.
Decision: PACS OHIF's deliberate host networking is an explicit per-file option (`allowHostNetwork`), not a global exception.
Verified: unit tests, tsc, eslint, audit passes on the three repo compose files.
