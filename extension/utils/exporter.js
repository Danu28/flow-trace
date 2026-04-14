/**
 * Code Exporter
 * Generates test automation code from recorded flows
 * - Selenium Java + TestNG with WebDriverWait
 * - Rest Assured with given/when/then
 */

class CodeExporter {
  constructor() {
    this.indent = '    ';
    this.newLine = '\n';
  }

  /**
   * Export flow to Selenium Java + TestNG code
   * @param {Object} flowData - Flow data from correlation engine
   * @param {string} className - Test class name
   * @returns {string} Generated Java code
   */
  exportSelenium(flowData, className = 'GeneratedTest') {
    try {
      const imports = this.generateSeleniumImports();
      const classDeclaration = this.generateClassDeclaration(className);
      const fieldDeclarations = this.generateFieldDeclarations();
      const setupMethod = this.generateSetupMethod();
      const teardownMethod = this.generateTeardownMethod();
      const testMethod = this.generateTestMethod(flowData);

      return [
        imports,
        classDeclaration,
        fieldDeclarations,
        setupMethod,
        testMethod,
        teardownMethod,
        '}'
      ].join(this.newLine);
    } catch (e) {
      return `// Error generating Selenium code: ${e.message}\n// Received flowData: ${JSON.stringify(flowData || {})}`;
    }
  }

  /**
   * Generate Selenium imports
   * @returns {string} Import statements
   */
  generateSeleniumImports() {
    return [
      'package com.test;',
      '',
      'import org.openqa.selenium.*;',
      'import org.openqa.selenium.support.ui.WebDriverWait;',
      'import org.openqa.selenium.support.ui.ExpectedConditions;',
      'import org.testng.Assert;',
      'import org.testng.annotations.*;',
      'import java.time.Duration;',
      ''
    ].join(this.newLine);
  }

  /**
   * Generate class declaration
   * @param {string} className - Class name
   * @returns {string} Class declaration
   */
  generateClassDeclaration(className) {
    return `public class ${className} {${this.newLine}`;
  }

  /**
   * Generate field declarations
   * @returns {string} Field declarations
   */
  generateFieldDeclarations() {
    return [
      this.indent + 'private WebDriver driver;',
      this.indent + 'private WebDriverWait wait;',
      ''
    ].join(this.newLine);
  }

  /**
   * Generate setup method
   * @returns {string} BeforeMethod annotation and setup code
   */
  generateSetupMethod() {
    return [
      this.indent + '@BeforeMethod',
      this.indent + 'public void setUp() {',
      this.indent + this.indent + 'driver = new ChromeDriver();',
      this.indent + this.indent + 'driver.manage().window().maximize();',
      this.indent + this.indent + 'wait = new WebDriverWait(driver, Duration.ofSeconds(10));',
      this.indent + '}',
      ''
    ].join(this.newLine);
  }

  /**
   * Generate teardown method
   * @returns {string} AfterMethod annotation and teardown code
   */
  generateTeardownMethod() {
    return [
      this.indent + '@AfterMethod',
      this.indent + 'public void tearDown() {',
      this.indent + this.indent + 'if (driver != null) {',
      this.indent + this.indent + this.indent + 'driver.quit();',
      this.indent + this.indent + '}',
      this.indent + '}',
      ''
    ].join(this.newLine);
  }

  /**
   * Generate test method from flow data
   * @param {Object} flowData - Flow data
   * @returns {string} Test method code
   */
  generateTestMethod(flowData) {
    const steps = (flowData && flowData.flow) ? flowData.flow : [];

    const lines = [
      this.indent + '@Test',
      this.indent + 'public void testUserFlow() {',
      this.indent + this.indent + '// Navigate to base URL',
      this.indent + this.indent + 'driver.get("https://example.com");',
      this.newLine
    ];

    steps.forEach((step, index) => {
      const stepNum = index + 1;
      
      // Generate UI action code
      if (step.step) {
        lines.push(this.indent + this.indent + `// Step ${stepNum}: ${step.step.type || 'Action'}`);
        lines.push(...this.generateSeleniumAction(step.step));
      }

      // Generate API validation code (comments for reference)
      if (step.apiCalls && step.apiCalls.length > 0) {
        lines.push(this.indent + this.indent + `// API Call: ${step.apiCalls[0].method || 'GET'} ${this.truncateUrl(step.apiCalls[0].url || '')}`);
        lines.push(this.indent + this.indent + `// Expected Status: ${step.apiCalls[0].status || '200'}`);
      }

      // Generate DOM change validation
      if (step.domChanges && step.domChanges.length > 0) {
        lines.push(this.indent + this.indent + '// Wait for UI update after API response');
        lines.push(this.indent + this.indent + 'wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector(".updated-element")));');
      }

      lines.push('');
    });

    lines.push(this.indent + '}');

    return lines.join(this.newLine);
  }

  /**
   * Generate Selenium code for a single action
   * @param {Object} action - UI action
   * @returns {Array<string>} Code lines
   */
  generateSeleniumAction(action) {
    const lines = [];
    const selector = this.getBestSelector(action);
    const byType = this.getByType(selector);

    switch (action.type) {
      case 'click':
        lines.push(
          this.indent + this.indent + `wait.until(ExpectedConditions.elementToBeClickable(${byType})).click();`
        );
        break;

      case 'input':
      case 'type':
        const value = action.value || 'text';
        lines.push(
          this.indent + this.indent + `WebElement input${action.id || ''} = wait.until(ExpectedConditions.visibilityOfElementLocated(${byType}));`,
          this.indent + this.indent + `input${action.id || ''}.clear();`,
          this.indent + this.indent + `input${action.id || ''}.sendKeys("${this.escapeString(value)}");`
        );
        break;

      case 'select':
        const selectedValue = action.selectedValue || action.value || 'option';
        lines.push(
          this.indent + this.indent + `Select select${action.id || ''} = new Select(wait.until(ExpectedConditions.visibilityOfElementLocated(${byType})));`,
          this.indent + this.indent + `select${action.id || ''}.selectByValue("${this.escapeString(selectedValue)}");`
        );
        break;

      case 'navigate':
        const url = action.url || 'about:blank';
        lines.push(
          this.indent + this.indent + `driver.navigate().to("${this.escapeString(url)}");`
        );
        break;

      case 'scroll':
        lines.push(
          this.indent + this.indent + `((JavascriptExecutor) driver).executeScript("window.scrollBy(0, ${action.y || 500})");`
        );
        break;

      default:
        lines.push(
          this.indent + this.indent + `// Unknown action type: ${action.type}`,
          this.indent + this.indent + `wait.until(ExpectedConditions.elementToBeClickable(${byType})).click();`
        );
    }

    return lines;
  }

  /**
   * Get best selector from action
   * Priority: id > data-* > name > class > xpath
   * @param {Object} action - UI action
   * @returns {string} Best selector value
   */
  getBestSelector(action) {
    if (action.selector) {
      // Check for id
      if (action.selector.id) return action.selector.id;
      // Check for data-*
      if (action.selector.dataTestId) return `[data-testid="${action.selector.dataTestId}"]`;
      if (action.selector.dataCy) return `[data-cy="${action.selector.dataCy}"]`;
      // Check for name
      if (action.selector.name) return `[name="${action.selector.name}"]`;
      // Check for class
      if (action.selector.class) return `.${action.selector.class.split(' ')[0]}`;
    }
    
    // Fallback to xpath
    return action.selector?.xpath || '//body';
  }

  /**
   * Get Selenium By type from selector
   * @param {string} selector - Selector string
   * @returns {string} By type code
   */
  getByType(selector) {
    if (selector.startsWith('//')) {
      return `By.xpath("${selector}")`;
    } else if (selector.startsWith('.')) {
      return `By.cssSelector("${selector}")`;
    } else if (selector.startsWith('[')) {
      return `By.cssSelector("${selector}")`;
    } else if (selector.startsWith('#')) {
      return `By.id("${selector.substring(1)}")`;
    } else {
      return `By.id("${selector}")`;
    }
  }

  /**
   * Export flow to Rest Assured code
   * @param {Object} flowData - Flow data from correlation engine
   * @param {string} className - Test class name
   * @returns {string} Generated Java code
   */
  exportRestAssured(flowData, className = 'APITest') {
    try {
      const imports = this.generateRestAssuredImports();
      const classDeclaration = this.generateClassDeclaration(className);
      const fieldDeclarations = this.generateRestAssuredFields();
      const setupMethod = this.generateRestAssuredSetup();
      const testMethods = this.generateRestAssuredTests(flowData);

      return [
        imports,
        classDeclaration,
        fieldDeclarations,
        setupMethod,
        testMethods,
        '}'
      ].join(this.newLine);
    } catch (e) {
      return `// Error generating Rest Assured code: ${e.message}\n// Received flowData: ${JSON.stringify(flowData || {})}`;
    }
  }

  /**
   * Generate Rest Assured imports
   * @returns {string} Import statements
   */
  generateRestAssuredImports() {
    return [
      'package com.test;',
      '',
      'import io.restassured.RestAssured;',
      'import io.restassured.http.ContentType;',
      'import io.restassured.response.Response;',
      'import io.restassured.specification.RequestSpecification;',
      'import org.testng.Assert;',
      'import org.testng.annotations.*;',
      'import java.util.HashMap;',
      'import java.util.Map;',
      'import static io.restassured.RestAssured.*;',
      'import static org.hamcrest.Matchers.*;',
      ''
    ].join(this.newLine);
  }

  /**
   * Generate Rest Assured field declarations
   * @returns {string} Field declarations
   */
  generateRestAssuredFields() {
    return [
      this.indent + 'private static final String BASE_URI = "https://api.example.com";',
      this.indent + 'private RequestSpecification spec;',
      ''
    ].join(this.newLine);
  }

  /**
   * Generate Rest Assured setup method
   * @returns {string} BeforeClass annotation and setup code
   */
  generateRestAssuredSetup() {
    return [
      this.indent + '@BeforeClass',
      this.indent + 'public void setup() {',
      this.indent + this.indent + 'RestAssured.baseURI = BASE_URI;',
      this.indent + this.indent + 'spec = given().contentType(ContentType.JSON);',
      this.indent + '}',
      ''
    ].join(this.newLine);
  }

  /**
   * Generate Rest Assured test methods from flow data
   * @param {Object} flowData - Flow data
   * @returns {string} Test methods code
   */
  generateRestAssuredTests(flowData) {
    const lines = [];

    flowData.flow.forEach((step, index) => {
      if (!step.apiCalls || step.apiCalls.length === 0) return;

      const testNum = index + 1;
      const apiCall = step.apiCalls[0];
      const testName = this.generateTestName(step, testNum);

      lines.push(this.indent + '@Test');
      lines.push(this.indent + `public void ${testName}() {`);
      lines.push(this.indent + this.indent + `// ${step.step?.type || 'Action'} -> API Call`);
      lines.push('');

      // Generate request
      lines.push(...this.generateRestAssuredRequest(apiCall, step.step));
      lines.push('');

      // Generate assertions
      lines.push(...this.generateRestAssuredAssertions(apiCall));
      lines.push(this.indent + '}');
      lines.push('');
    });

    return lines.join(this.newLine);
  }

  /**
   * Generate test method name
   * @param {Object} step - Flow step
   * @param {number} testNum - Test number
   * @returns {string} Test method name
   */
  generateTestName(step, testNum) {
    const actionType = step.step?.type || 'action';
    return `test${actionType.charAt(0).toUpperCase() + actionType.slice(1)}_Step${testNum}`;
  }

  /**
   * Generate Rest Assured request code
   * @param {Object} apiCall - API call data
   * @param {Object} uiAction - Related UI action
   * @returns {Array<string>} Code lines
   */
  generateRestAssuredRequest(apiCall, uiAction) {
    const lines = [];
    const method = (apiCall.method || 'GET').toLowerCase();
    const url = apiCall.url || '/endpoint';
    const body = apiCall.body || apiCall.requestBody || (apiCall.request && apiCall.request.postData ? apiCall.request.postData.text : null) || null;

    // Start request
    lines.push(this.indent + this.indent + 'Response response = spec');
    lines.push(this.indent + this.indent + '    .when()');

    // Add method and URL
    if (method === 'get') {
      lines.push(this.indent + this.indent + `    .get("${this.escapeString(url)}")`);
    } else if (method === 'post') {
      if (body) {
        lines.push(this.indent + this.indent + '    .body("""');
        lines.push(this.indent + this.indent + this.escapeJson(body));
        lines.push(this.indent + this.indent + '    """)');
      }
      lines.push(this.indent + this.indent + `    .post("${this.escapeString(url)}")`);
    } else if (method === 'put') {
      if (body) {
        lines.push(this.indent + this.indent + '    .body("""');
        lines.push(this.indent + this.indent + this.escapeJson(body));
        lines.push(this.indent + this.indent + '    """)');
      }
      lines.push(this.indent + this.indent + `    .put("${this.escapeString(url)}")`);
    } else if (method === 'delete') {
      lines.push(this.indent + this.indent + `    .delete("${this.escapeString(url)}")`);
    } else if (method === 'patch') {
      if (body) {
        lines.push(this.indent + this.indent + '    .body("""');
        lines.push(this.indent + this.indent + this.escapeJson(body));
        lines.push(this.indent + this.indent + '    """)');
      }
      lines.push(this.indent + this.indent + `    .patch("${this.escapeString(url)}")`);
    }

    lines.push(this.indent + this.indent + '    .then()');

    return lines;
  }

  /**
   * Generate Rest Assured assertions
   * @param {Object} apiCall - API call data
   * @returns {Array<string>} Assertion code lines
   */
  generateRestAssuredAssertions(apiCall) {
    const lines = [];
    const status = apiCall.status || 200;

    // Status code assertion
    lines.push(this.indent + this.indent + `    .statusCode(${status})`);

    // Add response body assertions if available (support multiple field names)
    const resp = apiCall.response || apiCall.responseBody || (apiCall.response && apiCall.response.body) || null;
    if (resp) {
      const responseBody = typeof resp === 'object' ? resp : this.safeParse(resp);

      if (responseBody) {
        if (responseBody.id) {
          lines.push(this.indent + this.indent + '    .body("id", notNullValue())');
        }
        if (responseBody.status) {
          lines.push(this.indent + this.indent + `    .body("status", equalTo("${responseBody.status}"))`);
        }
        if (responseBody.success !== undefined) {
          lines.push(this.indent + this.indent + `    .body("success", equalTo(${responseBody.success}))`);
        }
      }
    }

    lines.push(this.indent + this.indent + '    .extract().response();');

    return lines;
  }

  /**
   * Escape string for Java
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  escapeString(str) {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  /**
   * Escape JSON for text block
   * @param {string|Object} json - JSON to escape
   * @returns {string} Escaped JSON
   */
  escapeJson(json) {
    const jsonStr = typeof json === 'object' 
      ? JSON.stringify(json, null, 2)
      : json;
    return jsonStr;
  }

  /**
   * Safely parse JSON string
   * @param {string} jsonStr - JSON string
   * @returns {Object|null} Parsed object or null
   */
  safeParse(jsonStr) {
    try {
      return typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    } catch (e) {
      return null;
    }
  }

  /**
   * Truncate URL for display
   * @param {string} url - URL
   * @param {number} maxLength - Max length
   * @returns {string} Truncated URL
   */
  truncateUrl(url, maxLength = 50) {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + '...';
  }

  /**
   * Export to combined file (Selenium + Rest Assured)
   * @param {Object} flowData - Flow data
   * @param {string} seleniumClass - Selenium class name
   * @param {string} restAssuredClass - Rest Assured class name
   * @returns {Object} Object with both code strings
   */
  exportCombined(flowData, seleniumClass = 'GeneratedTest', restAssuredClass = 'APITest') {
    return {
      selenium: this.exportSelenium(flowData, seleniumClass),
      restAssured: this.exportRestAssured(flowData, restAssuredClass)
    };
  }
}

// Export for use in other modules (CommonJS)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CodeExporter;
}

// Make available globally for workers, content scripts, and other environments
if (typeof globalThis !== 'undefined') {
  globalThis.CodeExporter = CodeExporter;
}
