import React, { useState, useEffect } from 'react';
import { UserCircle, Plus, Menu, Moon, Sun, Bot, User } from 'lucide-react';
import { auth } from './firebase';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword } from 'firebase/auth';
import axios from 'axios';
import './App.css';

const formatResult = (rows) => {
  if (!rows || rows.length === 0) return 'No results found';

  const flattenObject = (obj, prefix = '') => {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      if (typeof value === 'object' && value !== null) {
        return { ...acc, ...flattenObject(value, `${prefix}${key}.`) };
      }
      return { ...acc, [`${prefix}${key}`]: value };
    }, {});
  };

  return rows
    .map(row => {
      const flattened = flattenObject(row);
      return Object.entries(flattened)
        .map(([key, value]) => `${key}: ${value}`)
        .join(' | ');
    })
    .join('\n');
};

const formatStringOutput = (output) => {
  if (typeof output !== 'string') return JSON.stringify(output, null, 2);
  if (output.includes('GenreName') && output.includes('TrackCount')) {
    return output.replace(/GenreName:/g, '\nGenreName:').trim();
  }
  return output;
};

function ChatApp() {
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const [nlQuery, setNlQuery] = useState('');
  const [connectionType, setConnectionType] = useState('sql');
  const [selectedCollection, setSelectedCollection] = useState('users');
  const [loading, setLoading] = useState(false);
  const [showQuery, setShowQuery] = useState(false);
  const [showVisualization, setShowVisualization] = useState(false); // New state for visualization tab
  const [lastQuery, setLastQuery] = useState(null);
  const [lastVisualization, setLastVisualization] = useState(null); // New state for visualization data
  const [darkMode, setDarkMode] = useState(false);
  const [showUserInfo, setShowUserInfo] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [manager, setManager] = useState(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [authChecking, setAuthChecking] = useState(true);

  const backendURL = 'https://c522-197-36-140-217.ngrok-free.app/safe-query'; // Update for your deployment

  const collections = ['branches', 'users', 'companies'];

  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
  }, [darkMode]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setManager(user);
      setAuthChecking(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (connectionType === 'nosql' && !collections.includes(selectedCollection)) {
      setSelectedCollection('users');
    }
  }, [connectionType]);

  const toggleTheme = () => setDarkMode(prev => !prev);
  const toggleSidebar = () => setSidebarOpen(prev => !prev);
  const toggleConnectionType = () => {
    setConnectionType(prev => prev === 'sql' ? 'nosql' : 'sql');
    setShowVisualization(false); // Reset visualization tab when switching connection type
  };

  const executeQuery = async (query) => {
    if (!query.trim()) return;

    if (query.toLowerCase().includes("who are you")) {
      setMessages(prev => [...prev, { text: query, sender: 'user' }, {
        text: "I'm LexaQuery, purpose-built to streamline data interaction by converting natural language into precise SQL and NoSQL queries. Whether you're working with relational databases like MySQL or non-relational systems such as Typesense, I ensure accurate command execution and real-time access to your data. My goal is to make complex database operations accessible and efficient for users at all technical levels.",
        sender: 'bot'
      }]);
      setHistory(prev => [...prev, query]);
      setNlQuery('');
      return;
    }

    setLoading(true);
    setShowQuery(false);
    setShowVisualization(false); // Reset visualization tab on new query

    const newMessages = [...messages, { text: query, sender: 'user' }];
    setMessages(newMessages);
    setHistory((prevHistory) => [...prevHistory, query]);
    setNlQuery('');

    try {
      const payload = {
        question: query,
        connection_type: connectionType,
        ...(connectionType === 'nosql' && { db_connection: selectedCollection })
      };
      console.log("Sending request to backend:", payload);

      const res = await axios.post(backendURL, payload);

      let responseData, queryText, resultData, errorFlag, messageText, visualizationData;

      if (res.data.sql_response) {
        responseData = res.data.sql_response;
        queryText = responseData.sql_query;
        resultData = responseData.result;
        errorFlag = responseData.error;
        messageText = responseData.message;
        visualizationData = responseData.visualization; // Get visualization data
      } else if (res.data.typesense_response) {
        responseData = res.data.typesense_response;
        queryText = responseData.typesense_query ? JSON.stringify(responseData.typesense_query, null, 2) : '';
        resultData = responseData.result;
        errorFlag = responseData.error;
        messageText = responseData.message;
        visualizationData = null; // No visualization for Typesense
      } else {
        throw new Error('Unexpected response format');
      }

      if (errorFlag) {
        setMessages(prevMessages => [
          ...prevMessages,
          { 
            text: messageText || "❌ Sorry, I can't process this request. Anything else? 🙂", 
            sender: 'bot' 
          }
        ]);
        setLastVisualization(null); // Clear visualization on error
      } else if (queryText) {
        setLastQuery(queryText);
        setLastVisualization(visualizationData); // Set visualization data

        let queryResult;
        if (connectionType === 'sql' && Array.isArray(resultData) && resultData.length > 0) {
          queryResult = formatResult(resultData);
        } else if (connectionType === 'nosql' && resultData.found > 0) {
          if (query.toLowerCase().includes('how many')) {
            queryResult = `Found ${resultData.found} matching documents`;
          } else {
            queryResult = resultData.hits.map(hit => JSON.stringify(hit.document, null, 2)).join('\n');
          }
        } else if (typeof resultData === 'string') {
          queryResult = formatStringOutput(resultData);
        } else {
          queryResult = 'No results found';
        }

        setMessages((prevMessages) => [
          ...prevMessages,
          { text: queryResult, sender: 'bot' },
        ]);
      } else if (messageText) {
        const formattedMessage = formatStringOutput(messageText);
        setMessages((prevMessages) => [
          ...prevMessages,
          {
            text: formattedMessage,
            sender: 'bot',
          },
        ]);
        setLastVisualization(null); // Clear visualization for non-query responses
      } else {
        setMessages((prevMessages) => [
          ...prevMessages,
          {
            text: 'Unexpected response from the model',
            sender: 'bot',
          },
        ]);
        setLastVisualization(null); // Clear visualization on unexpected response
      }
    } catch (error) {
      console.error('Error details:', error);
      let errorMessage = 'Error connecting to the backend';

      if (error.response && error.response.data) {
        errorMessage = error.response.data.detail || error.response.data.message || error.message;
        if (errorMessage.includes('SQL Execution Error')) {
          errorMessage = "❌ Sorry, I can't process this request. Anything else(sqlerror)? 🙂";
        }
      }

      setMessages((prevMessages) => [
        ...prevMessages,
        { text: errorMessage, sender: 'bot' },
      ]);
      setLastVisualization(null); // Clear visualization on error
    }

    setLoading(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!nlQuery.trim()) return;
    executeQuery(nlQuery);
  };

  const starterQuestions = [
    "List sales in Canada",
    "Top 5 products by total price",
    "Sales with quantity greater than 3"
  ];

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
    } catch (err) {
      setAuthError('Login failed: ' + err.message);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleRegister = async (e) => {
    e.preventDefault();
    setRegisterError('');
    try {
      await createUserWithEmailAndPassword(auth, registerEmail, registerPassword);
      setShowRegister(false);
      setLoginEmail(registerEmail);
      setLoginPassword(registerPassword);
      setRegisterEmail('');
      setRegisterPassword('');
    } catch (err) {
      setRegisterError('Registration failed: ' + err.message);
    }
  };

  if (authChecking) {
    return <div style={{height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', color: '#888'}}>Loading...</div>;
  }

  if (!manager) {
    return (
      <div className="login-bg">
        <div className="login-blob"></div>
        <div className="login-glass">
          <div className="login-logo">
            <UserCircle size={40} />
          </div>
          <h2>{showRegister ? 'Manager Registration' : 'Manager Login'}</h2>
          {showRegister ? (
            <form onSubmit={handleRegister}>
              <div className="login-input-wrapper">
                <input
                  type="email"
                  placeholder="Manager Email"
                  value={registerEmail}
                  onChange={e => setRegisterEmail(e.target.value)}
                  required
                />
              </div>
              <div className="login-input-wrapper">
                <input
                  type="password"
                  placeholder="Password"
                  value={registerPassword}
                  onChange={e => setRegisterPassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit">Register</button>
              <button type="button" className="login-toggle" onClick={() => setShowRegister(false)}>
                Already have an account? Login
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin}>
              <div className="login-input-wrapper">
                <input
                  type="email"
                  placeholder="Manager Email"
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  required
                />
              </div>
              <div className="login-input-wrapper">
                <input
                  type="password"
                  placeholder="Password"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit">Login</button>
              <button type="button" className="login-toggle" onClick={() => setShowRegister(true)}>
                New here? Register
              </button>
            </form>
          )}
          {authError && !showRegister && <div className="login-error">{authError}</div>}
          {registerError && showRegister && <div className="login-error">{registerError}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-wrapper" style={{
      '--bg-color': darkMode ? '#1e1e2e' : '#f3f3f3',
      '--text-color': darkMode ? '#e4e4e7' : '#333333',
      '--sidebar-bg': darkMode ? '#27272f' : '#e5e7eb',
      '--chat-message-user-bg': darkMode ? '#2d2d3a' : '#343541',
      '--chat-message-user-color': darkMode ? '#e4e4e7' : 'white',
      '--chat-message-bot-bg': darkMode ? '#34344a' : '#f7f7fc',
      '--chat-message-bot-color': darkMode ? '#e4e4e7' : 'black',
      '--input-bg': darkMode ? '#2d2d3a' : '#f7f7fc',
      '--button-bg': '#10a37f',
      '--button-color': 'white',
      '--toggle-button-bg': darkMode ? '#383846' : '#ececf1',
      '--toggle-button-color': darkMode ? '#e4e4e7' : '#444',
      '--header-color': darkMode ? '#e4e4e7' : '#444',
      '--border-color': darkMode ? '#444' : '#ddd',
      '--disclaimer-bg': darkMode ? '#27272f' : '#f8f8f8',
      '--disclaimer-color': darkMode ? '#a1a1aa' : '#666',
      '--sql-message-bg': darkMode ? '#334' : '#eef',
      '--sql-message-color': darkMode ? '#e4e4e7' : 'black',
      height: '100vh',
      minHeight: '100vh',
      width: '100vw',
      minWidth: '100vw',
      overflow: 'hidden',
      backgroundColor: 'var(--bg-color)',
      position: 'fixed',
      top: 0,
      left: 0,
      zIndex: 0
    }}>
      <div style={{display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden'}}>
        <button 
          className="sidebar-toggle-button"
          onClick={toggleSidebar}
          title={sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
          style={{
            position: 'fixed',
            top: '20px',
            left: sidebarOpen ? 'calc(22vw - 24px)' : '20px',
            zIndex: 1000,
            background: 'var(--sidebar-bg)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '12px',
            cursor: 'pointer',
            color: 'var(--text-color)',
            fontSize: '16px',
            transition: 'all 0.3s cubic-bezier(.39,.575,.565,1.000)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}
        >
          <Menu />
        </button>

        {sidebarOpen && (
          <aside className="history-sidebar" style={{
            width: '22%',
            backgroundColor: 'var(--sidebar-bg)',
            borderRight: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            transition: 'background-color 0.3s ease',
            height: '100vh',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '20px 20px 0 20px',
              flexShrink: 0
            }}>
              <h3 style={{
                margin: '0 0 20px',
                fontSize: '24px',
                color: 'var(--text-color)',
                fontWeight: '600',
                textAlign: 'center'
              }}>History</h3>
            </div>

            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '0 20px',
              minHeight: 0
            }}>
              <ul style={{
                listStyleType: 'none',
                padding: 0,
                margin: 0
              }}>
                {history.map((query, index) => (
                  <li 
                    key={index} 
                    onClick={() => executeQuery(query)}
                    style={{
                      padding: '14px',
                      cursor: 'pointer',
                      backgroundColor: 'var(--chat-message-bot-bg)',
                      borderRadius: '8px',
                      marginBottom: '10px',
                      transition: 'all 0.2s ease-in-out',
                      fontSize: '18px',
                      lineHeight: '1.4',
                      color: 'var(--text-color)'
                    }}
                    onMouseOver={(e) => {
                      e.target.style.backgroundColor = 'var(--chat-message-user-bg)';
                      e.target.style.color = 'var(--chat-message-user-color)';
                    }}
                    onMouseOut={(e) => {
                      e.target.style.backgroundColor = 'var(--chat-message-bot-bg)';
                      e.target.style.color = 'var(--text-color)';
                    }}
                  >
                    {query}
                  </li>
                ))}
              </ul>
            </div>

            <div style={{
              padding: '20px',
              borderTop: '1px solid var(--border-color)',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
              background: 'var(--sidebar-bg)'
            }}>
              <button 
                onClick={toggleConnectionType}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '18px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  backgroundColor: connectionType === 'sql' ? '#6366f1' : '#f59e0b',
                  color: 'white',
                  cursor: 'pointer',
                  fontWeight: '500',
                  transition: 'all 0.3s ease'
                }}
                onMouseOver={(e) => {
                  e.target.style.opacity = '0.9';
                }}
                onMouseOut={(e) => {
                  e.target.style.opacity = '1';
                }}
              >
                {connectionType === 'sql' ? 'Switch to NoSQL' : 'Switch to SQL'}
              </button>
              {connectionType === 'nosql' && (
                <div>
                  <label style={{
                    fontWeight: 'bold',
                    marginBottom: '10px',
                    display: 'block',
                    fontSize: '18px',
                    color: 'var(--text-color)'
                  }}>Select Collection</label>
                  <select
                    value={selectedCollection}
                    onChange={e => setSelectedCollection(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '18px',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      backgroundColor: 'var(--input-bg)',
                      color: 'var(--text-color)',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease'
                    }}
                  >
                    {collections.map(collection => (
                      <option key={collection} value={collection}>
                        {collection.charAt(0).toUpperCase() + collection.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{
                display: 'flex',
                gap: '10px',
                justifyContent: 'center',
                marginTop: '10px'
              }}>
                <button 
                  className="enhanced-icon-button new-chat"
                  onClick={() => setMessages([])} 
                  title="New Chat"
                  style={{
                    background: 'linear-gradient(135deg, #10a37f, #0d8a6c)',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '12px 16px',
                    cursor: 'pointer',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 2px 8px rgba(16, 163, 127, 0.3)'
                  }}
                  onMouseOver={(e) => {
                    e.target.style.transform = 'translateY(-2px)';
                    e.target.style.boxShadow = '0 4px 12px rgba(16, 163, 127, 0.4)';
                  }}
                  onMouseOut={(e) => {
                    e.target.style.transform = 'translateY(0)';
                    e.target.style.boxShadow = '0 2px 8px rgba(16, 163, 127, 0.3)';
                  }}
                >
                  <Plus /> New Chat
                </button>
                <button 
                  className="enhanced-icon-button theme-toggle"
                  onClick={toggleTheme} 
                  title="Toggle Dark Mode"
                  style={{
                    background: darkMode 
                      ? 'linear-gradient(135deg, #fbbf24, #f59e0b)' 
                      : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '12px',
                    cursor: 'pointer',
                    color: 'white',
                    fontSize: '16px',
                    transition: 'all 0.3s ease',
                    boxShadow: darkMode 
                      ? '0 2px 8px rgba(251, 191, 36, 0.3)' 
                      : '0 2px 8px rgba(99, 102, 241, 0.3)'
                  }}
                  onMouseOver={(e) => {
                    e.target.style.transform = 'translateY(-2px) rotate(15deg)';
                    e.target.style.boxShadow = darkMode 
                      ? '0 4px 12px rgba(251, 191, 36, 0.4)' 
                      : '0 4px 12px rgba(99, 102, 241, 0.4)';
                  }}
                  onMouseOut={(e) => {
                    e.target.style.transform = 'translateY(0) rotate(0deg)';
                    e.target.style.boxShadow = darkMode 
                      ? '0 2px 8px rgba(251, 191, 36, 0.3)' 
                      : '0 2px 8px rgba(99, 102, 241, 0.3)';
                  }}
                >
                  {darkMode ? <Sun /> : <Moon />}
                </button>
              </div>
            </div>
          </aside>
        )}

        <main className="chat-container" style={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          height: '100vh',
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          minWidth: 0,
          backgroundColor: 'var(--bg-color)'
        }}>
          <header className="chat-header" style={{
            backgroundColor: 'var(--bg-color)',
            color: 'var(--header-color)',
            padding: '20px',
            fontSize: '26px',
            fontWeight: 'bold',
            borderBottom: '1px solid var(--border-color)',
            transition: 'background-color 0.3s ease',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            position: 'relative'
          }}>
            <div style={{
              position: 'absolute',
              left: '0',
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              pointerEvents: 'none',
              zIndex: 1
            }}>
              <span style={{
                pointerEvents: 'auto',
                fontSize: '2.6rem',
                fontWeight: 800,
                color: '#0d8a6c',
                letterSpacing: '1.5px',
                fontFamily: 'inherit'
              }}>LexaQuery</span>
            </div>
            <button 
              className="user-icon-button" 
              onClick={() => setShowUserInfo(!showUserInfo)}
              style={{
                position: 'absolute',
                right: '25px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--header-color)',
                fontSize: '26px',
                transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => {
                e.target.style.transform = 'scale(1.1)';
                e.target.style.color = 'var(--button-bg)';
              }}
              onMouseOut={(e) => {
                e.target.style.transform = 'scale(1)';
                e.target.style.color = 'var(--header-color)';
              }}
            >
              <UserCircle />
            </button>
          </header>

          {showUserInfo && (
            <div className="user-info-panel" style={{
              position: 'absolute',
              top: '52px',
              right: '8px',
              backgroundColor: 'var(--sidebar-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
              zIndex: 1000
            }}>
              <p style={{ margin: '0 0 10px', fontWeight: 'bold', color: 'var(--text-color)' }}>Manager: {manager.email}</p>
              <button onClick={handleLogout} style={{
                marginTop: '10px',
                padding: '8px 12px',
                background: '#10a37f',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer'
              }}>Logout</button>
            </div>
          )}

          <div className="chat-box" style={{
            flexGrow: 1,
            flexShrink: 1,
            minHeight: 0,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--bg-color)',
            width: '100%',
            transition: 'background-color 0.3s ease',
            padding: '25px 25px 32px 25px'
          }}>
            {messages.length === 0 && (
              <div className="suggestions-panel" style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '15px',
                alignItems: 'center',
                marginTop: '50px'
              }}>
                <div style={{ fontSize: '22px', fontWeight: 'bold', marginBottom: '18px', color: 'var(--text-color)' }}>
                  Hi {manager.email.split('@')[0]}!
                </div>
                {starterQuestions.map((q, idx) => (
                  <button 
                    key={idx} 
                    className="suggestion-chip" 
                    onClick={() => executeQuery(q)}
                    style={{
                      background: 'linear-gradient(135deg, var(--chat-message-bot-bg), var(--input-bg))',
                      border: '2px solid var(--border-color)',
                      borderRadius: '16px',
                      padding: '16px 24px',
                      fontSize: '16px',
                      color: 'var(--text-color)',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      fontWeight: '500',
                      minWidth: '300px',
                      textAlign: 'left',
                      position: 'relative',
                      overflow: 'hidden'
                    }}
                    onMouseOver={(e) => {
                      e.target.style.transform = 'translateY(-3px)';
                      e.target.style.boxShadow = '0 8px 25px rgba(0,0,0,0.15)';
                      e.target.style.borderColor = 'var(--button-bg)';
                    }}
                    onMouseOut={(e) => {
                      e.target.style.transform = 'translateY(0)';
                      e.target.style.boxShadow = 'none';
                      e.target.style.borderColor = 'var(--border-color)';
                    }}
                  >
                    <span style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px'
                    }}>
                      <Bot style={{ color: 'var(--button-bg)' }} />
                      {q}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {messages.map((msg, index) => (
              <div 
                key={index} 
                className={`chat-message ${msg.sender}`}
                style={{
                  maxWidth: '90%',
                  padding: '18px',
                  margin: '12px 0',
                  borderRadius: '12px',
                  wordWrap: 'break-word',
                  fontSize: '18px',
                  lineHeight: '1.5',
                  alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                  backgroundColor: msg.sender === 'user' ? 'var(--chat-message-user-bg)' : 'var(--chat-message-bot-bg)',
                  color: msg.sender === 'user' ? 'var(--chat-message-user-color)' : 'var(--chat-message-bot-color)',
                  borderBottomRightRadius: msg.sender === 'user' ? '4px' : '12px',
                  borderBottomLeftRadius: msg.sender === 'bot' ? '4px' : '12px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  marginRight: msg.sender === 'user' ? '24px' : undefined
                }}
              >
                <span style={{ 
                  fontSize: '16px', 
                  color: msg.sender === 'user' ? 'var(--chat-message-user-color)' : 'var(--button-bg)',
                  marginTop: '2px'
                }}>
                  {msg.sender === 'user' ? <User /> : <Bot />}
                </span>
                <div>
                  {msg.text.split('\n').map((line, i) => (
                    <React.Fragment key={i}>{line}<br /></React.Fragment>
                  ))}
                </div>
              </div>
            ))}
            {showQuery && lastQuery && (
              <div className="chat-message sql" style={{
                backgroundColor: 'var(--sql-message-bg)',
                color: 'var(--sql-message-color)',
                fontFamily: 'monospace',
                padding: '18px',
                borderRadius: '10px',
                marginTop: '12px',
                fontSize: '17px',
                maxWidth: '100%',
                whiteSpace: 'pre-wrap',
                lineHeight: '1.6'
              }}>
                {lastQuery}
              </div>
            )}
            {showVisualization && lastVisualization && (
              <div className="chat-message visualization" style={{
                backgroundColor: 'var(--sql-message-bg)',
                color: 'var(--sql-message-color)',
                padding: '18px',
                borderRadius: '10px',
                marginTop: '12px',
                maxWidth: '100%',
                display: 'flex',
                justifyContent: 'center'
              }}>
                <img 
                  src={`data:image/png;base64,${lastVisualization}`} 
                  alt="Query Visualization" 
                  style={{
                    maxWidth: '100%',
                    maxHeight: '400px',
                    objectFit: 'contain',
                    borderRadius: '8px'
                  }}
                />
              </div>
            )}
            {loading && (
              <div className="chat-message bot" style={{
                alignSelf: 'flex-start',
                backgroundColor: 'var(--chat-message-bot-bg)',
                color: 'var(--chat-message-bot-color)',
                padding: '18px',
                borderRadius: '12px',
                borderBottomLeftRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <Bot style={{ color: 'var(--button-bg)' }} />
                Generating response...
              </div>
            )}
          </div>

          <div 
            className="chat-input-form"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '20px',
              backgroundColor: 'var(--bg-color)',
              borderTop: '1px solid var(--border-color)',
              position: 'relative',
              borderRadius: '15px',
              margin: '0 15px 15px 15px',
              transition: 'background-color 0.3s ease',
              zIndex: 2
            }}
          >
            <input
              type="text"
              value={nlQuery}
              onChange={(e) => setNlQuery(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !loading) {
                  handleSubmit(e);
                }
              }}
              placeholder="Ask anything..."
              style={{
                flexGrow: 1,
                padding: '16px',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                fontSize: '18px',
                background: 'var(--input-bg)',
                color: 'var(--text-color)',
                marginRight: '15px'
              }}
            />
            <button
              type="button"
              onClick={() => setShowQuery(!showQuery)}
              disabled={!lastQuery}
              style={{
                backgroundColor: 'var(--toggle-button-bg)',
                color: 'var(--toggle-button-color)',
                border: 'none',
                padding: '14px 18px',
                borderRadius: '10px',
                fontSize: '18px',
                cursor: 'pointer',
                transition: 'all 0.3s',
                marginRight: '15px',
                fontWeight: '500'
              }}
              onMouseOver={(e) => {
                if (!e.target.disabled) {
                  e.target.style.backgroundColor = 'var(--button-bg)';
                  e.target.style.color = 'var(--button-color)';
                }
              }}
              onMouseOut={(e) => {
                if (!e.target.disabled) {
                  e.target.style.backgroundColor = 'var(--toggle-button-bg)';
                  e.target.style.color = 'var(--toggle-button-color)';
                }
              }}
            >
              {showQuery ? 'Hide Query' : 'Show Query'}
            </button>
            <button
              type="button"
              onClick={() => setShowVisualization(!showVisualization)}
              disabled={!lastVisualization}
              style={{
                backgroundColor: 'var(--toggle-button-bg)',
                color: 'var(--toggle-button-color)',
                border: 'none',
                padding: '14px 18px',
                borderRadius: '10px',
                fontSize: '18px',
                cursor: 'pointer',
                transition: 'all 0.3s',
                marginRight: '15px',
                fontWeight: '500'
              }}
              onMouseOver={(e) => {
                if (!e.target.disabled) {
                  e.target.style.backgroundColor = 'var(--button-bg)';
                  e.target.style.color = 'var(--button-color)';
                }
              }}
              onMouseOut={(e) => {
                if (!e.target.disabled) {
                  e.target.style.backgroundColor = 'var(--toggle-button-bg)';
                  e.target.style.color = 'var(--toggle-button-color)';
                }
              }}
            >
              {showVisualization ? 'Hide Visualization' : 'Show Visualization'}
            </button>
            <button 
              onClick={handleSubmit}
              disabled={loading}
              style={{
                backgroundColor: 'var(--button-bg)',
                color: 'var(--button-color)',
                border: 'none',
                padding: '14px 20px',
                fontSize: '18px',
                borderRadius: '10px',
                cursor: 'pointer',
                transition: 'background 0.3s',
                fontWeight: '500',
                opacity: loading ? 0.6 : 1
              }}
              onMouseOver={(e) => {
                if (!loading) {
                  e.target.style.backgroundColor = '#0d8a6c';
                }
              }}
              onMouseOut={(e) => {
                if (!loading) {
                  e.target.style.backgroundColor = 'var(--button-bg)';
                }
              }}
            >
              Send
            </button>
          </div>
        </main>
      </div>
      <div style={{
        position: 'fixed',
        bottom: 8,
        left: 0,
        width: '100vw',
        color: 'var(--disclaimer-color)',
        textAlign: 'center',
        fontSize: '15px',
        zIndex: 2000,
        letterSpacing: '0.01em',
        fontWeight: 500,
        background: 'none',
        boxShadow: 'none',
        padding: 0
      }}>
        LexaQuery can make mistakes. Check important info.
      </div>
    </div>
  );
}

export default ChatApp;