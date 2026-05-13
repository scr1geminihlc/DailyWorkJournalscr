import React, { useState, useEffect } from 'react';
import { signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';
import { doc, setDoc, onSnapshot, collection, getDocFromServer, serverTimestamp, Timestamp } from 'firebase/firestore';
import { 
  CheckCircle2, 
  Circle, 
  Clock, 
  Printer, 
  UserCircle, 
  Edit3, 
  Lock, 
  Calendar, 
  Info, 
  CalendarDays, 
  List, 
  Plus, 
  Trash2, 
  AlertCircle 
} from 'lucide-react';
import { auth, db } from './lib/firebase';

// --- Error Handling for Firestore ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, setErrorMessage?: (msg: string | null) => void) {
  const message = error instanceof Error ? error.message : String(error);
  const uid = auth.currentUser?.uid;
  const isAnon = auth.currentUser?.isAnonymous;
  
  const errInfo: FirestoreErrorInfo = {
    error: message,
    authInfo: {
      userId: uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: isAnon,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  if (setErrorMessage) {
    const displayMsg = message.includes('permission') 
      ? `權限不足 (UID: ${uid || '未登入'}, 匿名: ${isAnon ? '是' : '否'}, DB: ${db.app.options.projectId}/${(db as any)._databaseId?.database || 'default'})` 
      : message;
    setErrorMessage(`儲存失敗: ${displayMsg}`);
    setTimeout(() => setErrorMessage(null), 8000);
  }
  throw new Error(JSON.stringify(errInfo));
}

// --- Task Configuration based on CSV ---
const taskConfig = [
  {
    id: 'morning_open',
    time: '早上',
    title: '辦公室開門',
    desc: '將門長開 (卡長放直到逼兩聲)',
  },
  {
    id: 'morning_clean',
    time: '早上',
    title: '環境整潔 (掃地.擦桌.拖地.拉窗簾.澆花.洗水槽)',
    desc: '*副校長在時不打擾，等副校長外出時補整理。\n*適時檢查水壺有沒有水、咖啡喝完杯子清洗(副校長不在座位時)。\n*一個禮拜至少換一次水槽網(水槽網在洗手槽下方櫃子)。\n*視情況清洗水槽、拖地(拖把.水桶.清潔劑在茶水間)。',
  },
  {
    id: 'morning_coffee',
    time: '早上',
    title: '準備咖啡 (馬克杯/保溫瓶)',
    desc: '水量: Extra Long Coffee (旋轉) / 濃度: Standard Coffee (按鈕)。\n*馬克杯 : 2杯+1杯+一些熱水\n*開會保溫瓶 : 2杯+一些點熱水',
  },
  {
    id: 'morning_tea',
    time: '早上',
    title: '準備茶一壺',
    desc: '茶包袋 (1.5-2匙)茶葉。\n*杯杯、茶壺、保溫瓶都需用洗碗精清洗。',
  },
  {
    id: 'morning_lunch',
    time: '早上',
    title: '買楊副午餐',
    desc: '約11:00時，詢問秘書需不需要幫副校長買午餐。',
  },
  {
    id: 'afternoon_trash',
    time: '下午',
    title: '收垃圾與水槽清理',
    desc: '收垃圾並倒至茶水間公用垃圾桶。\n*倒垃圾時一併將水槽網的渣渣倒掉。',
  },
  {
    id: 'afternoon_wash',
    time: '下午',
    title: '茶具清洗與下班整理',
    desc: '*若後續沒訪客，下班前把茶水倒掉及洗茶壺 (可詢問秘書)。',
  },
  {
    id: 'anytime_mail',
    time: '下午',
    title: '郵件收發',
    desc: '收發室收郵務。',
  }
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'assistant' | 'supervisor'>('assistant'); 
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  
  useEffect(() => {
    console.log('App initialization checking status...');
    console.log('Firestore Database:', (db as any)._databaseId?.database || 'default');
    console.log('Auth Current User:', auth.currentUser?.uid || 'None');
  }, []);

  const [viewMode, setViewMode] = useState<'daily' | 'monthly'>('daily');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [allLogs, setAllLogs] = useState<Record<string, any>>({});
  
  const [isSaving, setIsSaving] = useState(false);
  const [newCustomTaskText, setNewCustomTaskText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const SUPERVISOR_PASSWORD = import.meta.env.VITE_SUPERVISOR_PASSWORD || 'admin'; 

  const logData = allLogs[selectedDate] || { tasks: {}, supervisorFeedback: '', assistantNotes: '', customTasks: [] };
  
  console.log('Current State:', { 
    uid: user?.uid, 
    role, 
    selectedDate, 
    hasData: !!allLogs[selectedDate],
    tasksCount: Object.keys(logData.tasks || {}).length
  });

  useEffect(() => {
    console.log('Registering onAuthStateChanged...');
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      console.log('Auth changed:', u ? `User: ${u.uid}` : 'No user');
      if (u) {
        setUser(u);
        setErrorMessage(null);
      } else {
        console.log('Attempting anonymous sign in...');
        try {
          const cred = await signInAnonymously(auth);
          console.log('Signed in anonymously:', cred.user.uid);
        } catch (error: any) {
          console.error('Auth error during silent sign-in:', error);
          if (error.code === 'auth/operation-not-allowed') {
            setErrorMessage('匿名登入未啟用。前進 Firebase 專案設定啟用 Anonymous 登入，或點擊下方嘗試 Google 登入。');
          } else {
            setErrorMessage('驗證失敗: ' + (error.message || '未知錯誤'));
          }
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Google Sign In Error:', error);
      setErrorMessage('Google 登入失敗: ' + error.message);
    }
  };

  // Validate Connection to Firestore
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    if (!user) return;

    const colRef = collection(db, 'dailyLogs');
    
    const unsubscribe = onSnapshot(
      colRef,
      (snapshot) => {
        const logs: Record<string, any> = {};
        snapshot.forEach((doc) => {
          logs[doc.id] = doc.data();
        });
        setAllLogs(logs);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'dailyLogs', setErrorMessage);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const updateDocData = async (newData: any) => {
    if (!auth.currentUser) {
      setErrorMessage('尚未連線，請稍後或使用 Google 登入');
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    const path = `dailyLogs/${selectedDate}`;
    console.log('UpdateDocData path:', path, 'data:', newData);
    try {
      const docRef = doc(db, 'dailyLogs', selectedDate);
      const finalData = {
        ...newData,
        updatedAt: serverTimestamp()
      };
      
      await setDoc(docRef, finalData, { merge: true });
      console.log('UpdateDocData successful');
    } catch (error) {
      console.error('UpdateDocData failed:', error);
      handleFirestoreError(error, OperationType.WRITE, path, setErrorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleTask = (taskId: string) => {
    console.log('toggleTask clicked:', taskId, 'Current role:', role);
    if (role === 'supervisor') return; 
    const currentTasks = logData.tasks || {};
    const newTasks = { ...currentTasks, [taskId]: !currentTasks[taskId] };
    console.log('Setting tasks to:', newTasks);
    // Optimistically update allLogs
    setAllLogs(prev => ({
      ...prev,
      [selectedDate]: {
        ...(prev[selectedDate] || {}),
        tasks: newTasks
      }
    }));

    updateDocData({ tasks: newTasks });
  };

  const handleSupervisorClick = () => {
    if (role === 'supervisor') return;
    setShowPasswordPrompt(true);
  };

  const verifyPassword = () => {
    if (passwordInput === SUPERVISOR_PASSWORD) {
      setRole('supervisor');
      setShowPasswordPrompt(false);
      setPasswordInput('');
      setPasswordError('');
    } else {
      setPasswordError('密碼錯誤，請重新輸入');
    }
  };

  const handleAddCustomTask = () => {
    if (!newCustomTaskText.trim() || role !== 'supervisor') return;
    const newTask = {
      id: `custom_${Date.now()}`,
      title: newCustomTaskText.trim(),
      completed: false
    };
    const updatedCustomTasks = [...(logData.customTasks || []), newTask];
    updateDocData({ customTasks: updatedCustomTasks });
    setNewCustomTaskText('');
  };

  const handleToggleCustomTask = (taskId: string) => {
    console.log('handleToggleCustomTask clicked:', taskId, 'Current role:', role);
    if (role === 'supervisor') return;
    const currentCustomTasks = logData.customTasks || [];
    const updatedCustomTasks = currentCustomTasks.map((task: any) => 
      task.id === taskId ? { ...task, completed: !task.completed } : task
    );
    console.log('Setting custom tasks to:', updatedCustomTasks);
    // Optimistically update allLogs
    setAllLogs(prev => {
      const currentLog = prev[selectedDate] || {};
      const currentCustomTasks = (currentLog.customTasks || []).map((t: any) => 
        t.id === taskId ? { ...t, completed: !t.completed } : t
      );
      return {
        ...prev,
        [selectedDate]: {
          ...currentLog,
          customCustomTasks: currentCustomTasks
        }
      };
    });

    updateDocData({ customTasks: updatedCustomTasks });
  };

  const handleRemoveCustomTask = (taskId: string) => {
    if (role !== 'supervisor') return;
    const updatedCustomTasks = (logData.customTasks || []).filter((task: any) => task.id !== taskId);
    updateDocData({ customTasks: updatedCustomTasks });
  };

  const handleFeedbackChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateDocData({ supervisorFeedback: e.target.value });
  };

  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateDocData({ assistantNotes: e.target.value });
  };

  const customTasksList = logData.customTasks || [];
  const completedRegularTasks = Object.values(logData.tasks || {}).filter(Boolean).length;
  const completedCustomTasks = customTasksList.filter((t: any) => t.completed).length;
  
  const totalCompletedTasks = completedRegularTasks + completedCustomTasks;
  const totalTasksCount = taskConfig.length + customTasksList.length;
  
  const progressPercent = totalTasksCount > 0 ? Math.round((totalCompletedTasks / totalTasksCount) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans print:bg-white print:p-0">
      
      <nav className="bg-white border-b shadow-sm sticky top-0 z-10 print:hidden">
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Clock className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-800">楊副校長室 - 專任助理工作日誌</h1>
          </div>

          <div className="flex items-center gap-4 w-full sm:w-auto">
            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setViewMode('daily')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'daily' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Calendar className="w-4 h-4" />
                日誌
              </button>
              <button
                onClick={() => setViewMode('monthly')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'monthly' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <List className="w-4 h-4" />
                月報表
              </button>
            </div>

            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setRole('assistant')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${role === 'assistant' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <UserCircle className="w-4 h-4" />
                我是助理
              </button>
              <button
                onClick={handleSupervisorClick}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${role === 'supervisor' ? 'bg-white shadow-sm text-amber-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Lock className="w-4 h-4" />
                主管/同仁
              </button>
            </div>

            <button 
              onClick={() => window.print()}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
            >
              <Printer className="w-4 h-4" />
              <span className="hidden sm:inline">列印 / 匯出PDF</span>
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 py-8 print:py-0">
        
        {viewMode === 'monthly' ? (
          <div className="space-y-6">
            <div className="hidden print:block text-center mb-8 border-b-2 border-slate-800 pb-4">
              <h1 className="text-2xl font-bold text-black mb-2">楊副校長室 專任助理工作月報表</h1>
              <p className="text-lg text-slate-600">紀錄月份：{selectedMonth.split('-')[0]} 年 {selectedMonth.split('-')[1]} 月</p>
            </div>

            <div className="flex justify-between items-end print:hidden mb-6">
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
                  <CalendarDays className="w-4 h-4" />
                  選擇月份
                </label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden print:border-none print:shadow-none">
              <div className="overflow-x-auto print:overflow-visible">
                <table className="w-full text-left text-sm print:text-[13px]">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 print:bg-white print:border-b-2 print:border-slate-800">
                    <tr>
                      <th className="px-4 py-3 font-semibold w-24">日期</th>
                      <th className="px-4 py-3 font-semibold w-24">完成度</th>
                      <th className="px-4 py-3 font-semibold w-1/3">助理備註</th>
                      <th className="px-4 py-3 font-semibold w-1/3">主管提醒事項</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 print:divide-slate-300">
                    {Array.from({ length: new Date(parseInt(selectedMonth.split('-')[0]), parseInt(selectedMonth.split('-')[1]), 0).getDate() }, (_, i) => {
                      const dateStr = `${selectedMonth}-${String(i + 1).padStart(2, '0')}`;
                      const dayData = allLogs[dateStr] || {};
                      
                      const dayCustomTasks = dayData.customTasks || [];
                      const completedRegular = Object.values(dayData.tasks || {}).filter(Boolean).length;
                      const completedCustom = dayCustomTasks.filter((t: any) => t.completed).length;
                      
                      const completed = completedRegular + completedCustom;
                      const total = taskConfig.length + dayCustomTasks.length;
                      
                      const isToday = dateStr === new Date().toISOString().split('T')[0];
                      const isIncomplete = completed > 0 && completed < total; 
                      const hasFeedback = !!dayData.supervisorFeedback;

                      return (
                        <tr key={dateStr} className={`
                          ${isToday ? 'bg-blue-50/40' : ''} 
                          ${isIncomplete ? 'bg-red-50/60' : ''}
                          ${hasFeedback ? 'bg-amber-50/40' : ''}
                          hover:bg-slate-50 transition-colors
                        `}>
                          <td className="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">
                            {dateStr.split('-').slice(1).join('/')}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              completed === total && total > 0 ? 'bg-emerald-100 text-emerald-700' :
                              completed > 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'
                            }`}>
                              {completed} / {total}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-pre-wrap">
                            {dayData.assistantNotes || '-'}
                          </td>
                          <td className={`px-4 py-3 whitespace-pre-wrap ${hasFeedback ? 'text-amber-700 font-medium print:text-black' : 'text-slate-600'}`}>
                            {dayData.supervisorFeedback || '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="hidden print:flex justify-end mt-12 gap-16 pr-8">
              <div className="text-center">
                <div className="w-40 border-b border-black mb-2"></div>
                <span className="text-slate-600">專任助理簽名</span>
              </div>
              <div className="text-center">
                <div className="w-40 border-b border-black mb-2"></div>
                <span className="text-slate-600">主管/檢核人簽名</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="hidden print:block text-center mb-8 border-b-2 border-slate-800 pb-4">
              <h1 className="text-2xl font-bold text-black mb-2">楊副校長室 專任助理工作日誌</h1>
              <p className="text-lg text-slate-600">紀錄日期：{selectedDate}</p>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 gap-4 print:hidden">
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  選擇日期
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>

              <div className="bg-white px-4 py-3 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4 min-w-[200px]">
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-slate-600">今日完成度</span>
                    <span className="font-bold text-blue-600">{progressPercent}%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 transition-all duration-500 ease-out"
                      style={{ width: `${progressPercent}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            {role === 'assistant' && (
              <div className="bg-blue-50 text-blue-800 p-4 rounded-lg flex items-start gap-3 mb-6 border border-blue-100 print:hidden">
                <Info className="w-5 h-5 mt-0.5 shrink-0" />
                <p className="text-sm">
                  請確實核對並勾選完成的工作項目。最下方的主管提醒事項僅供檢視，若有任何問題請於「助理備註」中說明。
                </p>
              </div>
            )}

            <div className="space-y-6">
              {['早上', '下午', '不定時'].map((timeGroup) => {
                const groupTasks = taskConfig.filter(t => t.time === timeGroup);
                if (groupTasks.length === 0) return null;

                return (
                  <div key={timeGroup} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden print:border-slate-300 print:shadow-none print:mb-4">
                    <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center gap-2 print:bg-slate-100">
                      <Clock className="w-4 h-4 text-slate-500" />
                      <h2 className="font-semibold text-slate-700">{timeGroup}任務</h2>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {groupTasks.map((task) => {
                        const isCompleted = logData.tasks?.[task.id] || false;
                        return (
                          <div 
                            key={task.id} 
                            className={`p-5 transition-colors ${isCompleted ? 'bg-slate-50/50' : 'hover:bg-slate-50'} print:p-3 flex items-start gap-4`}
                          >
                            <button
                              onClick={() => toggleTask(task.id)}
                              disabled={role === 'supervisor'}
                              className={`mt-1 flex-shrink-0 transition-transform active:scale-90 ${role === 'supervisor' ? 'cursor-default opacity-50' : 'cursor-pointer'}`}
                            >
                              {isCompleted ? (
                                <CheckCircle2 className="w-6 h-6 text-emerald-500 print:text-black" />
                              ) : (
                                <Circle className="w-6 h-6 text-slate-300 hover:text-blue-400 print:text-slate-400" />
                              )}
                            </button>
                            <div>
                              <h3 className={`font-medium mb-1 ${isCompleted ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-800'}`}>
                                {task.title}
                              </h3>
                              <p className="text-sm text-slate-500 whitespace-pre-wrap leading-relaxed">
                                {task.desc}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden print:border-slate-300 print:shadow-none print:mb-4">
                <div className="bg-indigo-50 px-5 py-3 border-b border-indigo-100 flex items-center gap-2 print:bg-slate-100 print:border-slate-200">
                  <AlertCircle className="w-4 h-4 text-indigo-500" />
                  <h2 className="font-semibold text-indigo-700">臨時交辦事項</h2>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 ml-auto print:hidden">
                    依當日狀況指派
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {customTasksList.map((task: any) => (
                    <div 
                      key={task.id} 
                      className={`p-5 transition-colors ${task.completed ? 'bg-slate-50/50' : 'hover:bg-slate-50'} print:p-3 flex items-start gap-4`}
                    >
                      <button
                        onClick={() => handleToggleCustomTask(task.id)}
                        disabled={role === 'supervisor'}
                        className={`mt-1 flex-shrink-0 transition-transform active:scale-90 ${role === 'supervisor' ? 'cursor-default opacity-50' : 'cursor-pointer'}`}
                      >
                        {task.completed ? (
                          <CheckCircle2 className="w-6 h-6 text-emerald-500 print:text-black" />
                        ) : (
                          <Circle className="w-6 h-6 text-slate-300 hover:text-indigo-400 print:text-slate-400" />
                        )}
                      </button>
                      <div className="flex-1">
                        <h3 className={`font-medium mt-1 ${task.completed ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-800'}`}>
                          {task.title}
                        </h3>
                      </div>
                      {role === 'supervisor' && (
                        <button 
                          onClick={() => handleRemoveCustomTask(task.id)}
                          className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all print:hidden"
                          title="刪除此項目"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  ))}

                  {role === 'supervisor' && (
                    <div className="p-5 bg-slate-50 flex items-center gap-3 print:hidden">
                      <input 
                        type="text" 
                        value={newCustomTaskText}
                        onChange={(e) => setNewCustomTaskText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCustomTask()}
                        placeholder="請輸入臨時交辦事項 (按 Enter 或點選右側按鈕)..."
                        className="flex-1 px-4 py-2 bg-white border border-slate-200 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                      />
                      <button
                        onClick={handleAddCustomTask}
                        disabled={!newCustomTaskText.trim()}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1 shrink-0"
                      >
                        <Plus className="w-4 h-4" />
                        新增
                      </button>
                    </div>
                  )}

                  {role === 'assistant' && customTasksList.length === 0 && (
                    <div className="p-8 text-center text-sm text-slate-500 bg-slate-50/50">
                      今日無臨時交辦事項
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6 mt-8">
              
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col print:border-slate-300 print:shadow-none">
                <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Edit3 className="w-4 h-4 text-slate-500" />
                    <h2 className="font-semibold text-slate-700">助理備註</h2>
                  </div>
                  {role === 'assistant' && <span className="text-xs text-slate-400">可編輯</span>}
                </div>
                <textarea
                  className={`p-5 w-full h-40 resize-none outline-none text-sm leading-relaxed
                    ${role === 'supervisor' ? 'bg-slate-50 text-slate-600' : 'bg-white text-slate-800 focus:bg-blue-50/10'}
                    print:p-3 print:h-24 print:bg-white print:border-none`}
                  placeholder={role === 'assistant' ? "在此輸入今日工作備註或遇到之問題..." : "無備註"}
                  value={logData.assistantNotes || ''}
                  onChange={handleNotesChange}
                  disabled={role === 'supervisor'}
                />
              </div>

              <div className={`rounded-xl shadow-sm border overflow-hidden flex flex-col print:border-slate-300 print:shadow-none ${role === 'supervisor' ? 'border-amber-200 bg-white' : 'border-slate-200 bg-slate-50'}`}>
                <div className={`px-5 py-3 border-b flex items-center justify-between ${role === 'supervisor' ? 'bg-amber-50 border-amber-100' : 'bg-slate-100 border-slate-200 print:bg-slate-100'}`}>
                  <div className="flex items-center gap-2">
                    <Lock className={`w-4 h-4 ${role === 'supervisor' ? 'text-amber-600' : 'text-slate-500'}`} />
                    <h2 className={`font-semibold ${role === 'supervisor' ? 'text-amber-800' : 'text-slate-700'}`}>
                      主管/同仁 提醒與改進事項
                    </h2>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${role === 'supervisor' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-500'}`}>
                    {role === 'supervisor' ? '您可編輯' : '僅供檢視'}
                  </span>
                </div>
                <textarea
                  className={`p-5 w-full h-40 resize-none outline-none text-sm leading-relaxed
                    ${role === 'assistant' ? 'bg-slate-50 text-slate-600' : 'bg-white text-slate-800 focus:bg-amber-50/10'}
                    print:p-3 print:h-24 print:bg-white print:border-none`}
                  placeholder={role === 'supervisor' ? "請輸入需提醒或要求改進之事項。填寫後將即時同步，且助理無法修改。" : "目前無提醒事項。"}
                  value={logData.supervisorFeedback || ''}
                  onChange={handleFeedbackChange}
                  disabled={role === 'assistant'}
                />
              </div>

            </div>
          </>
        )}

        <div className="hidden print:flex justify-end mt-16 gap-16 pr-8">
          <div className="text-center">
            <div className="w-40 border-b border-black mb-2"></div>
            <span className="text-slate-600">專任助理簽名</span>
          </div>
          <div className="text-center">
            <div className="w-40 border-b border-black mb-2"></div>
            <span className="text-slate-600">主管/檢核人簽名</span>
          </div>
        </div>

        {/* Auth Status & Error Indicator */}
        <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 print:hidden">
          {!user && (
            <div className="flex flex-col gap-2">
              <div className="bg-amber-600 text-white px-3 py-1.5 rounded-full text-xs font-bold shadow-lg animate-pulse flex items-center gap-2">
                <Clock className="w-3 h-3" />
                連線中...
              </div>
              <button 
                onClick={handleGoogleSignIn}
                className="bg-white text-slate-700 px-4 py-2 rounded-xl text-sm font-bold shadow-xl border border-slate-200 hover:bg-slate-50 transition-colors flex items-center gap-2"
              >
                <UserCircle className="w-4 h-4 text-blue-600" />
                使用 Google 登入
              </button>
            </div>
          )}
          {errorMessage && (
            <div className="bg-red-600 text-white px-4 py-3 rounded-xl shadow-2xl flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-4 max-w-xs">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                <span className="font-medium text-sm">系統訊息</span>
              </div>
              <p className="text-xs opacity-90 leading-relaxed">{errorMessage}</p>
            </div>
          )}
        </div>

        <div className={`fixed bottom-4 right-4 bg-slate-800 text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg transition-opacity duration-300 print:hidden ${isSaving ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          儲存中...
        </div>

      </main>

      {showPasswordPrompt && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 print:hidden px-4">
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-sm transform transition-all">
            <div className="flex items-center gap-3 mb-4 text-amber-600">
              <Lock className="w-6 h-6" />
              <h3 className="text-lg font-bold text-slate-800">請輸入主管密碼</h3>
            </div>
            <p className="text-sm text-slate-500 mb-4">解鎖後即可編輯提醒事項與新增臨時交辦任務。</p>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(''); }}
              className={`w-full px-4 py-3 border rounded-xl mb-1 focus:ring-2 outline-none transition-all ${passwordError ? 'border-red-300 focus:ring-red-200' : 'border-slate-200 focus:ring-amber-200 focus:border-amber-500'}`}
              placeholder="預設密碼為: admin"
              onKeyDown={(e) => e.key === 'Enter' && verifyPassword()}
              autoFocus
            />
            {passwordError ? (
              <p className="text-red-500 text-sm mb-4 font-medium pl-1">{passwordError}</p>
            ) : (
              <div className="mb-4 h-5"></div>
            )}
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => { setShowPasswordPrompt(false); setPasswordInput(''); setPasswordError(''); }} 
                className="px-4 py-2.5 text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 font-medium transition-colors"
              >
                取消
              </button>
              <button 
                onClick={verifyPassword} 
                className="px-4 py-2.5 text-white bg-amber-600 rounded-xl hover:bg-amber-700 font-medium transition-colors"
              >
                確認解鎖
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
