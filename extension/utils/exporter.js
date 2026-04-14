/**
 * Code Exporter
 * Generates QA-oriented automation code from reviewed FlowTrace sessions.
 */

class CodeExporter {
  constructor() {
    this.indent = '    ';
    this.newLine = '\n';
  }

  exportSelenium(flowData, className = 'GeneratedTest') {
    try {
      const imports = this.generateSeleniumImports();
      const classDeclaration = this.generateClassDeclaration(className);
      const fieldDeclarations = this.generateFieldDeclarations(flowData);
      const setupMethod = this.generateSetupMethod(flowData);
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

  generateSeleniumImports() {
    return [
      'package com.test;',
      '',
      'import org.openqa.selenium.*;',
      'import org.openqa.selenium.chrome.ChromeDriver;',
      'import org.openqa.selenium.support.ui.WebDriverWait;',
      'import org.openqa.selenium.support.ui.ExpectedConditions;',
      'import org.testng.Assert;',
      'import org.testng.annotations.*;',
      'import java.time.Duration;',
      'import java.util.HashMap;',
      'import java.util.Map;',
      ''
    ].join(this.newLine);
  }

  generateClassDeclaration(className) {
    return `public class ${className} {${this.newLine}`;
  }

  generateFieldDeclarations(flowData) {
    const variables = this.collectProducedVariables(flowData);
    const variableLines = variables.map(variable =>
      `${this.indent}private String ${this.toJavaIdentifier(variable.name)};`
    );

    return [
      this.indent + 'private WebDriver driver;',
      this.indent + 'private WebDriverWait wait;',
      this.indent + 'private Map<String, String> flowVars = new HashMap<>();',
      ...variableLines,
      ''
    ].join(this.newLine);
  }

  generateSetupMethod(flowData) {
    const firstUrl = this.getBaseUrl(flowData);

    return [
      this.indent + '@BeforeMethod',
      this.indent + 'public void setUp() {',
      this.indent + this.indent + 'driver = new ChromeDriver();',
      this.indent + this.indent + 'driver.manage().window().maximize();',
      this.indent + this.indent + 'wait = new WebDriverWait(driver, Duration.ofSeconds(10));',
      this.indent + this.indent + `driver.get("${this.escapeString(firstUrl)}");`,
      this.indent + '}',
      ''
    ].join(this.newLine);
  }

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

  generateTestMethod(flowData) {
    const steps = this.getReviewedSteps(flowData);
    const lines = [
      this.indent + '@Test',
      this.indent + 'public void testReviewedFlow() {'
    ];

    if (!steps.length) {
      lines.push(this.indent + this.indent + '// No reviewed steps were available for export.');
      lines.push(this.indent + '}');
      return lines.join(this.newLine);
    }

    steps.forEach((step, index) => {
      lines.push('');
      lines.push(this.indent + this.indent + `// Step ${index + 1}: ${step.step?.type || 'action'}`);
      lines.push(...this.generateVariableAssignments(step.variables));
      lines.push(...this.generateSeleniumAction(step.step));
      lines.push(...this.generateApiReferenceComments(step.apiCalls));
      lines.push(...this.generateSeleniumAssertions(step));
    });

    lines.push(this.indent + '}');
    return lines.join(this.newLine);
  }

  generateVariableAssignments(variables) {
    const produced = variables?.produced || [];
    if (!produced.length) {
      return [];
    }

    return produced.map(variable =>
      `${this.indent}${this.indent}// Captured variable: ${this.toJavaIdentifier(variable.name)} (${this.escapeString(variable.valuePreview || '')})`
    );
  }

  generateSeleniumAction(action) {
    if (!action) {
      return [this.indent + this.indent + '// No UI action captured for this step'];
    }

    const lines = [];
    const selector = this.getBestSelector(action);
    const locator = this.getByType(selector);

    switch (action.type) {
      case 'click':
        lines.push(this.indent + this.indent + `wait.until(ExpectedConditions.elementToBeClickable(${locator})).click();`);
        break;

      case 'input':
      case 'type': {
        const variableName = this.toJavaIdentifier(action.elementName || action.placeholder || 'inputValue');
        const value = this.resolveActionInputValue(action);
        lines.push(this.indent + this.indent + `WebElement ${variableName}Field = wait.until(ExpectedConditions.visibilityOfElementLocated(${locator}));`);
        lines.push(this.indent + this.indent + `${variableName}Field.clear();`);
        lines.push(this.indent + this.indent + `${variableName}Field.sendKeys("${this.escapeString(value)}");`);
        break;
      }

      case 'focus':
        lines.push(this.indent + this.indent + `wait.until(ExpectedConditions.visibilityOfElementLocated(${locator})).click();`);
        break;

      case 'navigation':
      case 'spa_navigation': {
        const url = action.url || action.fromUrl || 'about:blank';
        lines.push(this.indent + this.indent + `driver.navigate().to("${this.escapeString(url)}");`);
        break;
      }

      default:
        lines.push(this.indent + this.indent + `// Unsupported action type ${action.type}; using click fallback`);
        lines.push(this.indent + this.indent + `wait.until(ExpectedConditions.elementToBeClickable(${locator})).click();`);
        break;
    }

    return lines;
  }

  generateApiReferenceComments(apiCalls) {
    const relevantApis = this.getRelevantApiCalls(apiCalls);
    if (!relevantApis.length) {
      return [];
    }

    return relevantApis.map(api =>
      `${this.indent}${this.indent}// API expectation: ${api.method || 'GET'} ${this.truncateUrl(api.url || '')} -> ${api.status || 'N/A'}`
    );
  }

  generateSeleniumAssertions(step) {
    const lines = [];
    const uiAssertions = step.assertions?.ui || [];
    const apiAssertions = step.assertions?.api || [];

    if (step.domChanges && step.domChanges.length > 0) {
      lines.push(this.indent + this.indent + '// Wait for UI updates observed during recording');
      lines.push(this.indent + this.indent + 'wait.until(driver -> ((JavascriptExecutor) driver).executeScript("return document.readyState").equals("complete"));');
    }

    uiAssertions.forEach(assertion => {
      lines.push(this.indent + this.indent + `// UI assertion: ${this.escapeComment(assertion)}`);
      lines.push(...this.generateUiAssertionLines(assertion));
    });

    apiAssertions.forEach(assertion => {
      lines.push(this.indent + this.indent + `// API assertion: ${this.escapeComment(assertion)}`);
    });

    return lines;
  }

  generateUiAssertionLines(assertion) {
    const normalized = assertion.toLowerCase();
    const quotedText = this.extractQuotedText(assertion);

    if (normalized.includes('url') && quotedText) {
      return [
        `${this.indent}${this.indent}Assert.assertTrue(driver.getCurrentUrl().contains("${this.escapeString(quotedText)}"));`
      ];
    }

    if ((normalized.includes('visible') || normalized.includes('display')) && quotedText) {
      return [
        `${this.indent}${this.indent}Assert.assertTrue(driver.getPageSource().contains("${this.escapeString(quotedText)}"));`
      ];
    }

    if ((normalized.includes('contains') || normalized.includes('text')) && quotedText) {
      return [
        `${this.indent}${this.indent}Assert.assertTrue(driver.getPageSource().contains("${this.escapeString(quotedText)}"));`
      ];
    }

    return [
      `${this.indent}${this.indent}// Manual assertion translation needed: ${this.escapeComment(assertion)}`
    ];
  }

  getBestSelector(action) {
    const candidates = action.selectorCandidates || action.selectorProfile?.candidates || [];
    if (candidates.length) {
      return candidates[0].value;
    }

    if (typeof action.selector === 'string' && action.selector) {
      return action.selector;
    }

    if (action.selectorProfile?.primary?.value) {
      return action.selectorProfile.primary.value;
    }

    return action.xpath || '//body';
  }

  getByType(selector) {
    if (!selector) {
      return 'By.xpath("//body")';
    }

    if (selector.startsWith('//') || selector.startsWith('/')) {
      return `By.xpath("${this.escapeString(selector)}")`;
    }

    if (selector.includes(':contains(')) {
      const safeText = selector.split(':contains("')[1]?.replace('")', '') || '';
      return `By.xpath("//*[contains(normalize-space(text()), '${this.escapeXPathText(safeText)}')]")`;
    }

    if (selector.startsWith('#')) {
      return `By.cssSelector("${this.escapeString(selector)}")`;
    }

    if (selector.startsWith('.') || selector.startsWith('[')) {
      return `By.cssSelector("${this.escapeString(selector)}")`;
    }

    return `By.cssSelector("${this.escapeString(selector)}")`;
  }

  exportRestAssured(flowData, className = 'APITest') {
    try {
      const imports = this.generateRestAssuredImports();
      const classDeclaration = this.generateClassDeclaration(className);
      const fieldDeclarations = this.generateRestAssuredFields(flowData);
      const setupMethod = this.generateRestAssuredSetup(flowData);
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

  generateRestAssuredImports() {
    return [
      'package com.test;',
      '',
      'import io.restassured.RestAssured;',
      'import io.restassured.http.ContentType;',
      'import io.restassured.response.Response;',
      'import io.restassured.specification.RequestSpecification;',
      'import org.testng.annotations.*;',
      'import java.util.HashMap;',
      'import java.util.Map;',
      'import static io.restassured.RestAssured.*;',
      'import static org.hamcrest.Matchers.*;',
      ''
    ].join(this.newLine);
  }

  generateRestAssuredFields(flowData) {
    const variables = this.collectProducedVariables(flowData);
    const variableLines = variables.map(variable =>
      `${this.indent}private String ${this.toJavaIdentifier(variable.name)};`
    );

    return [
      this.indent + `private static final String BASE_URI = "${this.escapeString(this.getApiBaseUri(flowData))}";`,
      this.indent + 'private RequestSpecification spec;',
      this.indent + 'private Map<String, String> flowVars = new HashMap<>();',
      ...variableLines,
      ''
    ].join(this.newLine);
  }

  generateRestAssuredSetup(flowData) {
    return [
      this.indent + '@BeforeClass',
      this.indent + 'public void setup() {',
      this.indent + this.indent + 'RestAssured.baseURI = BASE_URI;',
      this.indent + this.indent + 'spec = given().contentType(ContentType.JSON);',
      this.indent + '}',
      ''
    ].join(this.newLine);
  }

  generateRestAssuredTests(flowData) {
    const lines = [];
    const steps = this.getReviewedSteps(flowData);

    steps.forEach((step, index) => {
      const relevantApis = this.getRelevantApiCalls(step.apiCalls);
      if (!relevantApis.length) {
        return;
      }

      const apiCall = relevantApis[0];
      const testName = this.generateTestName(step, index + 1);

      lines.push(this.indent + '@Test');
      lines.push(this.indent + `public void ${testName}() {`);
      lines.push(this.indent + this.indent + `// ${step.step?.type || 'Action'} reviewed API validation`);
      lines.push(...this.generateRestVariableComments(step.variables));
      lines.push(...this.generateRestAssuredRequest(apiCall));
      lines.push(...this.generateRestAssuredAssertions(apiCall, step.assertions?.api || []));
      lines.push(this.indent + '}');
      lines.push('');
    });

    if (!lines.length) {
      lines.push(this.indent + '// No reviewed API steps available for Rest Assured export.');
      lines.push('');
    }

    return lines.join(this.newLine);
  }

  generateTestName(step, testNum) {
    const actionType = step.step?.type || 'action';
    return `test${actionType.charAt(0).toUpperCase() + actionType.slice(1)}Step${testNum}`;
  }

  generateRestVariableComments(variables) {
    const produced = variables?.produced || [];
    return produced.map(variable =>
      `${this.indent}${this.indent}// Produced variable: ${this.toJavaIdentifier(variable.name)} from ${variable.source}`
    );
  }

  generateRestAssuredRequest(apiCall) {
    const lines = [];
    const method = (apiCall.method || 'GET').toLowerCase();
    const path = this.getRelativeApiPath(apiCall.url || '/');
    const body = apiCall.requestBody || null;

    lines.push(this.indent + this.indent + 'Response response = spec');

    if (body) {
      lines.push(this.indent + this.indent + '    .body("""');
      lines.push(this.indent + this.indent + this.escapeJson(body));
      lines.push(this.indent + this.indent + '    """)');
    }

    lines.push(this.indent + this.indent + '    .when()');
    lines.push(this.indent + this.indent + `    .${method}("${this.escapeString(path)}")`);
    lines.push(this.indent + this.indent + '    .then()');

    return lines;
  }

  generateRestAssuredAssertions(apiCall, reviewAssertions) {
    const lines = [];
    const status = apiCall.status || 200;
    const responseBody = this.safeParse(apiCall.responseBody);

    lines.push(this.indent + this.indent + `    .statusCode(${status})`);

    const autoAssertions = this.generateAutomaticApiAssertions(responseBody);
    autoAssertions.forEach(assertion => lines.push(this.indent + this.indent + assertion));

    reviewAssertions.forEach(assertion => {
      lines.push(this.indent + this.indent + `    // Review assertion: ${this.escapeComment(assertion)}`);
    });

    lines.push(this.indent + this.indent + '    .extract().response();');
    return lines;
  }

  generateAutomaticApiAssertions(responseBody) {
    if (!responseBody || typeof responseBody !== 'object') {
      return [];
    }

    const lines = [];
    if (responseBody.id !== undefined) {
      lines.push('.body("id", notNullValue())');
    }
    if (responseBody.status !== undefined) {
      lines.push(`.body("status", equalTo("${this.escapeString(String(responseBody.status))}"))`);
    }
    if (responseBody.success !== undefined) {
      lines.push(`.body("success", equalTo(${responseBody.success}))`);
    }

    return lines;
  }

  exportCombined(flowData, seleniumClass = 'GeneratedTest', restAssuredClass = 'APITest') {
    return {
      selenium: this.exportSelenium(flowData, seleniumClass),
      restAssured: this.exportRestAssured(flowData, restAssuredClass)
    };
  }

  getReviewedSteps(flowData) {
    const steps = flowData?.flow || [];
    return steps.filter(step => (step.review?.status || 'pending') !== 'ignored');
  }

  getRelevantApiCalls(apiCalls = []) {
    return apiCalls.filter(api => api.reviewSelection !== 'ignored');
  }

  collectProducedVariables(flowData) {
    const steps = this.getReviewedSteps(flowData);
    const unique = new Map();

    steps.forEach(step => {
      (step.variables?.produced || []).forEach(variable => {
        if (!unique.has(variable.name)) {
          unique.set(variable.name, variable);
        }
      });
    });

    return Array.from(unique.values());
  }

  resolveActionInputValue(action) {
    if (action.inputValue) {
      return action.inputValue;
    }

    if (action.value) {
      return action.value;
    }

    return 'sample-value';
  }

  getBaseUrl(flowData) {
    const firstStep = this.getReviewedSteps(flowData)[0];
    return firstStep?.step?.url || 'https://example.com';
  }

  getApiBaseUri(flowData) {
    const firstApi = this.getReviewedSteps(flowData)
      .flatMap(step => this.getRelevantApiCalls(step.apiCalls))
      .find(Boolean);

    if (!firstApi?.url) {
      return 'https://api.example.com';
    }

    try {
      const parsed = new URL(firstApi.url);
      return `${parsed.protocol}//${parsed.host}`;
    } catch (error) {
      return 'https://api.example.com';
    }
  }

  getRelativeApiPath(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    } catch (error) {
      return url;
    }
  }

  extractQuotedText(assertion) {
    const match = assertion.match(/["']([^"']+)["']/);
    return match ? match[1] : '';
  }

  toJavaIdentifier(name) {
    const cleaned = String(name || 'value')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!cleaned.length) {
      return 'value';
    }

    return cleaned
      .map((part, index) => {
        const safe = part.replace(/^[0-9]+/, '');
        const normalized = safe || 'value';
        return index === 0
          ? normalized.charAt(0).toLowerCase() + normalized.slice(1)
          : normalized.charAt(0).toUpperCase() + normalized.slice(1);
      })
      .join('');
  }

  escapeString(str) {
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  escapeXPathText(str) {
    return String(str).replace(/'/g, "\\'");
  }

  escapeComment(str) {
    return String(str).replace(/\*\//g, '* /');
  }

  escapeJson(json) {
    return typeof json === 'object' ? JSON.stringify(json, null, 2) : String(json);
  }

  safeParse(jsonStr) {
    try {
      return typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    } catch (e) {
      return null;
    }
  }

  truncateUrl(url, maxLength = 60) {
    return url.length <= maxLength ? url : url.substring(0, maxLength) + '...';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CodeExporter;
}

if (typeof globalThis !== 'undefined') {
  globalThis.CodeExporter = CodeExporter;
}
