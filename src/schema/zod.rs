//! Hand-written validation with the exact messages Zod 4 gave 0.5.0 (`formatZodError`: `path : message`).
//!
//! A `.myterm.json` is hand-edited and committed, so the message is the product surface (AC1). No
//! generic schema engine: just the few primitives the two schemas use, checked against the original
//! by `tests/parity.rs`.

use serde_json::Value;

pub const MAX_SAFE_INT: f64 = 9007199254740991.0;

pub struct Validator {
    path: Vec<String>,
    pub issues: Vec<String>,
    /// Issues that stop Zod's cross-field refinements: a wrong type or value, as opposed to a size check.
    pub hard: usize,
}

pub fn received(v: Option<&Value>) -> &'static str {
    match v {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::String(_)) => "string",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    }
}

impl Validator {
    pub fn new() -> Self {
        Validator { path: Vec::new(), issues: Vec::new(), hard: 0 }
    }

    pub fn at<T>(&mut self, segment: impl ToString, f: impl FnOnce(&mut Self) -> T) -> T {
        self.path.push(segment.to_string());
        let out = f(self);
        self.path.pop();
        out
    }

    pub fn issue(&mut self, message: impl AsRef<str>) {
        self.hard += 1;
        self.issue_at(&[], message);
    }

    /// A size check (`.min()`/`.max()`): reported, but the value is still usable.
    pub fn soft_issue(&mut self, message: impl AsRef<str>) {
        self.issue_at(&[], message);
    }

    pub fn issue_at(&mut self, extra: &[String], message: impl AsRef<str>) {
        let full: Vec<&str> = self.path.iter().chain(extra.iter()).map(String::as_str).collect();
        let path = if full.is_empty() { "(racine)".to_string() } else { full.join(".") };
        self.issues.push(format!("{path} : {}", message.as_ref()));
    }

    pub fn count(&self) -> usize {
        self.issues.len()
    }

    /// `z.object`: anything but a plain object is one issue and stops there.
    pub fn object<'a>(&mut self, v: Option<&'a Value>) -> Option<&'a serde_json::Map<String, Value>> {
        match v {
            Some(Value::Object(m)) => Some(m),
            other => {
                self.issue(format!("Invalid input: expected object, received {}", received(other)));
                None
            }
        }
    }

    pub fn string(&mut self, v: Option<&Value>, min1: bool) -> Option<String> {
        match v {
            Some(Value::String(s)) => {
                if min1 && s.is_empty() {
                    self.soft_issue("Too small: expected string to have >=1 characters");
                    None
                } else {
                    Some(s.clone())
                }
            }
            other => {
                self.issue(format!("Invalid input: expected string, received {}", received(other)));
                None
            }
        }
    }

    /// `.optional()`: absent is fine, present must validate (`null` is not absent).
    pub fn optional_string(&mut self, v: Option<&Value>) -> Option<String> {
        v.and_then(|v| self.string(Some(v), false))
    }

    pub fn optional_bool(&mut self, v: Option<&Value>) -> Option<bool> {
        match v {
            None => None,
            Some(Value::Bool(b)) => Some(*b),
            other => {
                self.issue(format!("Invalid input: expected boolean, received {}", received(other)));
                None
            }
        }
    }

    pub fn boolean_or(&mut self, v: Option<&Value>, default: bool) -> bool {
        match v {
            None => default,
            _ => self.optional_bool(v).unwrap_or(default),
        }
    }

    /// `z.enum`: any value outside the list, whatever its type, gets the same message.
    pub fn choice<T: Copy>(&mut self, v: &Value, options: &[(&str, T)]) -> Option<T> {
        if let Value::String(s) = v {
            if let Some((_, t)) = options.iter().find(|(name, _)| name == s) {
                return Some(*t);
            }
        }
        let list: Vec<String> = options.iter().map(|(n, _)| format!("\"{n}\"")).collect();
        self.issue(format!("Invalid option: expected one of {}", list.join("|")));
        None
    }

    /// `z.number().int()` with an optional lower bound.
    pub fn int(&mut self, v: &Value, min: Option<i64>) -> Option<i64> {
        let Value::Number(n) = v else {
            self.issue(format!("Invalid input: expected number, received {}", received(Some(v))));
            return None;
        };
        let f = n.as_f64().unwrap_or(f64::NAN);
        if f.fract() != 0.0 {
            self.issue("Invalid input: expected int, received number");
            return None;
        }
        if f > MAX_SAFE_INT {
            self.issue("Too big: expected int to be <=9007199254740991");
            return None;
        }
        if f < -MAX_SAFE_INT {
            self.issue("Too small: expected int to be >=-9007199254740991");
            return None;
        }
        if let Some(min) = min {
            if f < min as f64 {
                self.issue(format!("Too small: expected number to be >={min}"));
                return None;
            }
        }
        Some(f as i64)
    }
}

impl Default for Validator {
    fn default() -> Self {
        Self::new()
    }
}
