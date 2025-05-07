# Oracle Connector for n8n

This connector enables direct integration with Oracle databases in n8n, offering operations to execute queries and SQL statements.

---

## 📥 Installation

1. Install the package in the `nodes` directory of n8n:
```bash
pnpm install @rempel/n8n-nodes-oracle
```
2. Restart n8n.

---

## 🔑 Credential Configuration

### Required Parameters:

| Field                             | Description                                                                |
|----------------------------------|----------------------------------------------------------------------------|
| **Connection Type**              | `Basic` (manual details) or `Connection String` (environment variable)     |
| **Host**                         | Oracle server address (for Basic type only)                                |
| **Port**                         | Oracle port (default: 1521)                                                |
| **Service Name**                 | Database Service Name or SID                                               |
| **Environment Variable Name**    | Name of the variable containing the connection string (e.g., `ORACLE_CONN_STRING`) |
| **User**                         | Database username                                                          |
| **Password**                     | User password                                                              |
| **Client Mode**                  | `Thin` (lightweight) or `Thick` (requires full Oracle client)             |

---

## 🛠 Available Operations

### 1. `Execute Query` (SELECT)
- **SQL Query**: SQL query to retrieve data.
  ```sql
  SELECT * FROM employees WHERE department_id = :deptId
  ```
- **Parameters**: JSON parameters (e.g., `{"deptId": 20}`).
- **Result Format**: Result formatting (`Uppercase`, `Lowercase`, `Original`).

### 2. `Execute Statement` (DML/DDL)
- **SQL Query**: Commands such as `INSERT`, `UPDATE`, or procedure calls.
  ```sql
  INSERT INTO employees (name, role) VALUES (:name, :role)
  ```
- **Auto Commit**: Enables automatic transaction commit.

---

## ⚙️ Advanced Settings

### Connection Pool Options:

| Parameter              | Description                          | Default |
|------------------------|--------------------------------------|---------|
| **Pool Min**           | Minimum connections in the pool      | 1       |
| **Pool Max**           | Maximum connections in the pool      | 10      |
| **Queue Timeout (Ms)** | Connection wait timeout in ms        | 30000   |

---

## 📋 Usage Example

### Scenario: Employee Query

1. **Credentials**:  
   - Type: `Basic`  
   - Host: `oracle-prod.example.com`  
   - User/Password: `admin/******`

2. **Oracle Node**:
   - **Operation**: `Execute Query`  
   - **Query**:
     ```sql
     SELECT first_name, salary FROM employees WHERE salary > :minSalary
     ```
   - **Parameters**: `{"minSalary": 5000}`  
   - **Format**: `Uppercase`

3. **Output**:
   ```json
   [
     { "FIRST_NAME": "John", "SALARY": 7500 },
     { "FIRST_NAME": "Maria", "SALARY": 6200 }
   ]
   ```

---

## ⚠️ Requirements and Notes

1. **Oracle Client**:  
   - For `Thick` mode, set the environment variables:
     ```bash
     ORACLE_CLIENT_LIB_PATH=/path/to/instantclient
     ORACLE_CLIENT_CONFIG_DIR=/path/to/network/admin
     ```

2. **Query Validation**:  
   - The `Execute Query` operation blocks non-SELECT commands (e.g., `INSERT`).

3. **Connection Strings**:  
   - Example of environment variable:
     ```
     ORACLE_CONN_STRING=(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=oracle-host)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=XE)))
     ```

---

## 🔄 Additional Resources

- **Repository**: [GitHub](https://github.com/rempel/n8n-oracle-connector)  
- **Support**: Submit issues on GitHub to report problems.  

Documentation updated for version 1.0.8. Tested with Oracle Database 19c and n8n 1.18+.

---

## 💸 Buy Me a Coffee

If you like this project, please consider buying me a coffee. Thank you for your support!

[![Buy Me a Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png)](https://www.buymeacoffee.com/rempel)
