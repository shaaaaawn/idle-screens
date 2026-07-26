import XCTest

@testable import IdleScreens

final class SystemActivityTests: XCTestCase {
  func testParseDockerPS() {
    let out = "web\tnginx:1.27\tUp 3 hours\ndb\tpostgres:16\tUp 2 days (healthy)\n"
    XCTAssertEqual(
      SystemActivity.parseDockerPS(out),
      ["web — nginx:1.27 (Up 3 hours)", "db — postgres:16 (Up 2 days (healthy))"])
  }

  func testParseDockerPSSkipsMalformedLines() {
    XCTAssertEqual(SystemActivity.parseDockerPS("\n\njust-a-name\n"), [])
  }

  func testParseContainerListSkipsHeader() {
    let out = """
      ID          IMAGE                OS     ARCH   STATE    ADDR
      my-nginx    docker.io/nginx:1    linux  arm64  running  192.168.64.3
      """
    XCTAssertEqual(SystemActivity.parseContainerList(out), ["my-nginx (docker.io/nginx:1)"])
  }

  func testParseMCPProcessesFiltersAndLabels() {
    let out = """
        123 /opt/homebrew/bin/node /Users/s/servers/mcp-filesystem/dist/index.js
        456 /usr/bin/some-daemon --flag
        789 npm exec @modelcontextprotocol/server-github
      """
    let parsed = SystemActivity.parseMCPProcesses(out)
    XCTAssertEqual(parsed.count, 2)
    XCTAssertEqual(parsed[0], "node · mcp-filesystem [123]")
    XCTAssertEqual(parsed[1], "npm · server-github [789]")
  }

  func testParseMCPProcessesGroupsDuplicateLabels() {
    let out = """
        10 node /a/mcp-server/i.js
        11 node /b/mcp-server/i.js
        12 node /c/mcp-server/i.js
      """
    XCTAssertEqual(SystemActivity.parseMCPProcesses(out), ["node · mcp-server ×3"])
  }

  func testParseMCPProcessesExcludesSelfAndPS() {
    let out = """
        11 /Applications/IdleScreens.app/Contents/MacOS/IdleScreens --mcp-ish
        22 ps -axo pid=,command=
      """
    XCTAssertEqual(SystemActivity.parseMCPProcesses(out), [])
  }

  func testParseListenersFiltersDedupesAndSorts() {
    let out = """
      COMMAND   PID  USER   FD   TYPE  DEVICE SIZE/OFF NODE NAME
      node      7155 shawn  23u  IPv6  0x1     0t0     TCP  [::1]:5199 (LISTEN)
      node      7155 shawn  24u  IPv4  0x2     0t0     TCP  127.0.0.1:5199 (LISTEN)
      workerd   4210 shawn  11u  IPv4  0x3     0t0     TCP  127.0.0.1:8787 (LISTEN)
      rapportd  600  shawn  5u   IPv4  0x4     0t0     TCP  *:52117 (LISTEN)
      Python    9001 shawn  3u   IPv4  0x5     0t0     TCP  127.0.0.1:8000 (LISTEN)
      """
    XCTAssertEqual(
      SystemActivity.parseListeners(out),
      ["node :5199 [7155]", "Python :8000 [9001]", "workerd :8787 [4210]"])
  }

  func testCappedAddsMoreLine() {
    let lines = (1...12).map(String.init)
    let capped = SystemActivity.capped(lines)
    XCTAssertEqual(capped.count, SystemActivity.sectionCap + 1)
    XCTAssertEqual(capped.last, "+4 more")
  }
}
