const fs = require("fs");
const path = require("path");
const axios = require("axios");
const colors = require("colors");
const { HttpsProxyAgent } = require("https-proxy-agent");
const readline = require("readline");
const user_agents = require("./config/userAgents");
const settings = require("./config/config");
const { sleep, loadData, getRandomNumber, saveToken, getRandomNineDigitNumber, isTokenExpired, saveJson, decodeJWT } = require("./utils");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { checkBaseUrl } = require("./checkAPI");

class ClientAPI {
  constructor(queryId, accountIndex, proxy, baseURL) {
    this.headers = {
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
      "Content-Type": "application/json",
      Origin: "https://miniapp.uxuy.one",
      referer: "https://miniapp.uxuy.one/",
      "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    };
    this.baseURL = baseURL;
    this.queryId = queryId;
    this.accountIndex = accountIndex;
    this.proxy = proxy;
    this.proxyIP = null;
    this.session_name = null;
    this.session_user_agents = this.#load_session_data();
  }

  #load_session_data() {
    try {
      const filePath = path.join(process.cwd(), "session_user_agents.json");
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      } else {
        throw error;
      }
    }
  }

  #get_random_user_agent() {
    const randomIndex = Math.floor(Math.random() * user_agents.length);
    return user_agents[randomIndex];
  }

  #get_user_agent() {
    if (this.session_user_agents[this.session_name]) {
      return this.session_user_agents[this.session_name];
    }

    console.log(`[Tài khoản ${this.accountIndex + 1}] Tạo user agent...`.blue);
    const newUserAgent = this.#get_random_user_agent();
    this.session_user_agents[this.session_name] = newUserAgent;
    this.#save_session_data(this.session_user_agents);
    return newUserAgent;
  }

  #save_session_data(session_user_agents) {
    const filePath = path.join(process.cwd(), "session_user_agents.json");
    fs.writeFileSync(filePath, JSON.stringify(session_user_agents, null, 2));
  }

  #get_platform(userAgent) {
    const platformPatterns = [
      { pattern: /iPhone/i, platform: "ios" },
      { pattern: /Android/i, platform: "android" },
      { pattern: /iPad/i, platform: "ios" },
    ];

    for (const { pattern, platform } of platformPatterns) {
      if (pattern.test(userAgent)) {
        return platform;
      }
    }

    return "Unknown";
  }

  #set_headers() {
    const platform = this.#get_platform(this.#get_user_agent());
    this.headers["sec-ch-ua"] = `Not)A;Brand";v="99", "${platform} WebView";v="127", "Chromium";v="127`;
    this.headers["sec-ch-ua-platform"] = platform;
    this.headers["User-Agent"] = this.#get_user_agent();
  }

  async createUserAgent() {
    try {
      const dataParse = decodeJWT(this.queryId);
      const userData = await JSON.parse(dataParse.payload.user);
      this.session_name = userData.userId;
      this.#get_user_agent();
    } catch (error) {
      this.log(`Can't create user agent, try get new token: ${error.message}`, "error");
      return;
    }
  }

  async log(msg, type = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const accountPrefix = `[Tài khoản ${this.accountIndex + 1}]`;
    const ipPrefix = this.proxyIP ? `[${this.proxyIP}]` : "[Unknown IP]";
    let logMessage = "";

    switch (type) {
      case "success":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.green;
        break;
      case "error":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.red;
        break;
      case "warning":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.yellow;
        break;
      case "custom":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.magenta;
        break;
      default:
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.blue;
    }
    console.log(logMessage);
  }

  async checkProxyIP() {
    try {
      const proxyAgent = new HttpsProxyAgent(this.proxy);
      const response = await axios.get("https://api.ipify.org?format=json", { httpsAgent: proxyAgent });
      if (response.status === 200) {
        this.proxyIP = response.data.ip;
        return response.data.ip;
      } else {
        throw new Error(`Cannot check proxy IP. Status code: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Error checking proxy IP: ${error.message}`);
    }
  }

  async makeRequest(url, method, data = {}, retries = 0) {
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${this.queryId}`,
    };
    const proxyAgent = new HttpsProxyAgent(this.proxy);
    let currRetries = 0,
      success = false;
    do {
      try {
        const response = await axios({
          method,
          url,
          data,
          headers,
          httpsAgent: proxyAgent,
          timeout: 30000,
        });
        success = true;
        if (response.data.result) return { success: true, data: response.data.result };
        else return { success: false, data: response.data, error: response.data.error };
      } catch (error) {
        this.log(`Yêu cầu thất bại: ${url} | ${error.message} | đang thử lại...`, "warning");
        success = false;
        await sleep(settings.DELAY_BETWEEN_REQUESTS);
        if (currRetries == retries) return { success: false, error: error.message };
      }
      currRetries++;
    } while (currRetries < retries && !success);
  }

  async auth() {
    const headers = {
      ...this.headers,
    };
    let currRetries = 0,
      success = false;
    const url = `https://miniapp.uxuy.one/jwt`;
    const formData = new FormData();
    const data = this.queryId;
    // Object.entries(this.queryId);
    // console.log("data", data);

    // for (const item of data) {
    //   formData.append(item[0], item[1]);
    // }

    // chat_instance: -298404396458566810;
    // chat_type: channel;
    // start_param: A_1092680235_inviteEarn;
    // process.exit(0);
    formData.append("user", JSON.stringify(data.user));
    formData.append("chat_instance", "-298404396458566810");
    formData.append("chat_type", "channel");
    formData.append("auth_date", data.auth_date);
    formData.append("signature", data.signature);
    formData.append("hash", data.hash);
    formData.append("start_param", "A_1092680235_inviteEarn");

    do {
      currRetries++;
      try {
        // const response = await axios({
        //   method: "POST",
        //   url,
        //   data: formData,
        //   headers,
        //   timeout: 30000,
        // });

        const response = await axios.post(url, formData, { headers });
        success = true;
        return { success: true, data: response.data };
      } catch (error) {
        console.log(error.response.data);

        success = false;
        return { success: false, error: error.message };
      }
    } while (currRetries < retries && !success);
  }

  async getUserInfo() {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_myPoint",
      params: [],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async getWalletRegister() {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_register",
      params: [
        "046cfed8d984f6bf11c27de9666261c3457d5dc2ec502ba7c5facac9618c2298bab0e8bb4b665fd8d567aad080141a0caa013a40765e602da565fcda847b39a7c1",
        "2d9ede87cc10737b754e899a2612cfdbb2d17ec942345f4d61e3a217dcd005ea",
        {
          tron: ["044c6874089604b8c0d7ea527add873fa5b4cfbe352daa7cefab42cd1adab20879f7db091c25dd08ce98a383012979fe30e45ec9db3564ff6748319b34b827c74f", ""],
          ton: [
            "043a92ee4a3af11541d5ef85a01696654381a144c6b3d777913e8f72caf0a468e0e13f47b078ce120391c2f451db51fc5f5e19f3e87186b9e02ec30c0a650de363",
            "6388cf477388a2566cb0af340e633ac4e036a6147cea80eb704a22de571a3a77",
          ],
          sui: [
            "043dcd93ff9fbdd46c5eb347ffc369f9e344ba8f06aa155c5ce98aecc24ee3f2b0e7c59b0d51e6d575c1bfc80842bc861628787e3d93faadc43f06df9a98734bba",
            "111ac9ce78462aedba8642a0ee63f7e23c9d4acce6b6021b7a2e414365ba3ad7",
          ],
          aptos: [
            "042d0ec4bd6885d1097aafff2080248579e37ab504609bc0974e2f0d0394bb6ca3a4b5103f8140e9f251fa1129616920293a9b92c07a09ae52a7e65d31f7f8732e",
            "8f6917557bfea543b3aedeb8b27e61cec5ff7ae8b76c084396cbc621c6a5b453",
          ],
        },
      ],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async getFarmInfo() {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_getFarmInfo",
      params: [],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async claimFarm(groupid, id) {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_claimFarm",
      params: [groupid, id, ""],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async startFarm(groupid, id) {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_startFarm",
      params: [groupid, id],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async myPoint() {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_myPoint",
      params: [],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async getTasks() {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_taskList",
      params: [false],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async completeTask(id, groupId) {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_taskClick",
      params: groupId ? [id, groupId, ""] : [id, ""],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async getTasksTransaction() {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_taskList",
      params: [false],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async claimTask(id, groupId) {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_taskClick",
      params: groupId ? [id, groupId, ""] : [id, ""],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async getAds() {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_adsList3",
      params: [false],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async clickAds(id, groupId) {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_adsClick",
      params: groupId ? [groupId, id] : [id],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async adsState(id, groupId) {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_adsState",
      params: groupId ? [groupId, id] : [id],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async claimAd(id, groupId) {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_adsClaim",
      params: [id, groupId],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async setTaskCompletionStatus(id, groupId) {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_setTaskCompletionStatus",
      params: [id, groupId],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async checkAdsState(id, groupId) {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_taskState",
      params: groupId ? [groupId, id] : [id],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async claimVideoAD(id, groupId) {
    return this.makeRequest(`${this.baseURL}`, "post", {
      method: "wallet_claimVideoAD",
      params: [groupId, id],
      id: getRandomNineDigitNumber(),
      jsonrpc: "2.0",
    });
  }

  async getValidToken() {
    const userId = this.session_name;
    const existingToken = this.queryId;
    let loginResult = null;

    const isExp = isTokenExpired(existingToken);
    if (existingToken && !isExp) {
      this.log("Using valid token", "success");
      return existingToken;
    } else {
      this.log("Token not found or expired, skipping...", "warning");
      // loginResult = await this.auth();
    }

    // if (loginResult?.success) {
    //   const { jwtData } = loginResult?.data;
    //   if (jwtData) {
    //     saveToken(userId, jwtData);
    //     this.token = jwtData;
    //   }

    //   return jwtData;
    // } else {
    //   this.log(`Can't get token, try get new query_id!`, "warning");
    // }
    return null;
  }

  async handleTasks(retries = 1) {
    let currRetries = retries;
    const resTasks = await this.getAds();
    if (resTasks.success) {
      let tasks = resTasks.data?.items || [];
      tasks = tasks.filter((t) => !t.rewarded && !settings.SKIP_TASKS.includes(t.id));
      if (tasks.length == 0) {
        this.log("No task to do", "warning");
      } else {
        for (const task of tasks) {
          await sleep(2);
          if (!task.clicked) {
            this.log(`Trying completing task ${task.id} | ${task.name} ...`);
            await this.clickAds(task.id, task.groupId);
            await this.adsState(task.id, task.groupId);
            await sleep(2);
          }

          if (task.finished) {
            const resClaim = await this.claimAd(task.id, task.groupId);
            if (resClaim.success) {
              if (!resClaim.data?.clicked && retries > 0) {
                this.log(`Trying verify task ${task.id} | ${task.name}...`);
              } else {
                this.log(`Claim task ${task.id} | ${task.name} sucessfully! | Reward: ${task.awardAmount || task.awards[0].amount}`, "success");

                this.log(`Trying claim video ads for task ${task.id} | ${task.name} | Waiting 30s...`);
                await sleep(30);
                const resClaimVideo = await this.claimVideoAD(task.id, task.groupId);
                if (resClaimVideo.success) {
                  this.log(`Claim video ads for task ${task.id} | ${task.name} sucessfully! | Reward: ${resClaimVideo.data[0]?.amount || JSON.stringify(resClaimVideo.data)}`, "success");
                } else {
                  this.log(`Claim video ads for task ${task.id} | ${task.name} failed: ${resClaimVideo.error.message}`, "warning");
                }
              }
            } else {
              this.log(`Claim task ${task.id} | ${task.name} failed: ${resClaim.error.message} | Task maybe need completed manually!`, "warning");
            }
          }
        }
      }
    }
    if (currRetries > 0) {
      currRetries--;
      return await this.handleTasks(currRetries);
    }
  }

  // async handleTasksOnclain(retries = 1) {
  //   const resTasks = await this.getTasks();
  //   if (resTasks.success) {
  //     let tasks = resTasks.data?.items || [];
  //     tasks.filter((t) => !t.finished && !settings.SKIP_TASKS.includes(t.id));
  //     if (tasks.length == 0) {
  //       this.log("No tasks to do", "warning");
  //     } else {
  //       for (const task of tasks) {
  //         await sleep(2);
  //         if (!task.clicked) {
  //           this.log(`Completing task ${task.id} | ${task.name} ...`);
  //           await this.completeTask(task.id);
  //           await this.clickAds(task.id);
  //           await sleep(2);
  //         }
  //         const resClaim = await this.claimTask(task.id);
  //         const resClaimAds = await this.claimAd(task.id);

  //         if (resClaim.success) {
  //           if (!resClaim.data?.clicked || !resClaimAds.data?.clicked) {
  //             this.log(`Verify task ${task.id} | ${task.name} sucessfully!`, "success");
  //           } else {
  //             this.log(`Claim task ${task.id} | ${task.name} sucessfully! | Reward: ${task.awardAmount}`, "success");
  //           }
  //         } else {
  //           this.log(`Claim task ${task.id} | ${task.name} failed!`, "warning");
  //         }
  //       }
  //     }
  //   }
  //   if (retries > 0) {
  //     retries--;
  //     return await this.handleTasksOnclain(retries);
  //   }
  // }

  async handleFarming() {
    const farmInfo = await this.getFarmInfo();
    if (farmInfo.success) {
      const { coolDown, sysTime, farmTime, finished, id, groupId, rewarded, awardAmount } = farmInfo.data;
      const finishTime = (farmTime || 0) + (coolDown || 0);
      const currentTime = sysTime || 0;

      if (currentTime < finishTime) {
        const remainingTime = finishTime - currentTime;
        const remainingMinutes = Math.floor(remainingTime / 60);
        const remainingSeconds = remainingTime % 60;
        return this.log(`No time to claimable, waiting ${remainingMinutes} minutes ${remainingSeconds} seconds to claim.`, "warning");
      }

      if (finished && !rewarded) {
        await sleep(1);
        const resClaim = await this.claimFarm(groupId, id);
        if (resClaim.success) {
          this.log(`Claim mining success! | Reward: ${awardAmount}`, "success");
        }
        await sleep(1);
        const resStart = await this.startFarm(groupId, id);
        if (resStart.success) {
          this.log(`Start farming success!`, "success");
        }
        return;
      }

      if (rewarded) {
        const resStart = await this.startFarm(groupId, id);
        if (resStart.success) {
          this.log(`Start farming success!`, "success");
        }
        return;
      }
    }
  }

  async runAccount() {
    try {
      this.proxyIP = await this.checkProxyIP();
    } catch (error) {
      this.log(`Cannot check proxy IP: ${error.message}`, "warning");
      return;
    }

    const accountIndex = this.accountIndex;
    const initData = this.queryId;
    const dataParse = decodeJWT(initData);
    const userData = await JSON.parse(dataParse.payload.user);
    const firstName = userData.firstName || "";
    const lastName = userData.lastName || "";
    this.session_name = userData.userId;

    const timesleep = getRandomNumber(settings.DELAY_START_BOT[0], settings.DELAY_START_BOT[1]);
    console.log(`=========Tài khoản ${accountIndex + 1}| ${firstName + " " + lastName} | ${this.proxyIP} | Bắt đầu sau ${timesleep} giây...`.green);
    this.#set_headers();
    await sleep(timesleep);

    const token = await this.getValidToken();
    if (!token) {
      this.log("Không tìm thấy token hoặc token đã hết hạn...skiping", "error");
      return;
    }
    const data = await this.getWalletRegister();
    const farmInfo = await this.getFarmInfo();

    if (!data?.data?.alias || !farmInfo?.data?.token) {
      return this.log("Không thể lấy thông tin user...bỏ qua", "warning");
    }
    const { decimals, balance } = farmInfo?.data?.token;
    const formattedBalance = (parseInt(balance) / Math.pow(10, decimals)).toFixed(decimals);
    this.log(`Username: ${data?.data?.alias[0]} | Balances: ${formattedBalance} UP`);
    await this.handleTasks(1);
    await this.handleFarming();
  }
}

async function runWorker(workerData) {
  const { queryId, accountIndex, proxy, hasIDAPI } = workerData;
  const to = new ClientAPI(queryId, accountIndex, proxy, hasIDAPI);
  try {
    await Promise.race([to.runAccount(), new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 24 * 60 * 60 * 1000))]);
    parentPort.postMessage({
      accountIndex,
    });
  } catch (error) {
    parentPort.postMessage({ accountIndex, error: error.message });
  } finally {
    if (!isMainThread) {
      parentPort.postMessage("taskComplete");
    }
  }
}

async function main() {
  const queryIds = loadData("data.txt");
  const proxies = loadData("proxy.txt");
  // let tokens = {};
  // let rfTokens = {};

  // try {
  //   tokens = require("./token.json");
  //   rfTokens = require("./refresh_token.json");
  // } catch (error) {
  //   tokens = {};
  //   rfTokens = {};
  // }

  if (queryIds.length > proxies.length) {
    console.log("Số lượng proxy và data phải bằng nhau.".red);
    console.log(`Data: ${queryIds.length}`);
    console.log(`Proxy: ${proxies.length}`);
    process.exit(1);
  }
  console.log(colors.yellow("Tool được phát triển bởi nhóm tele Airdrop Hunter Siêu Tốc (https://t.me/airdrophuntersieutoc)"));

  let maxThreads = settings.MAX_THEADS;

  const { endpoint: hasIDAPI, message } = await checkBaseUrl();
  if (!hasIDAPI) return console.log(`Không thể tìm thấy ID API, thử lại sau!`.red);
  console.log(`${message}`.yellow);
  // process.exit();
  queryIds.map(async (val, i) => await new ClientAPI(val, i, proxies[i], hasIDAPI).createUserAgent());

  await sleep(1);
  while (true) {
    let currentIndex = 0;
    const errors = [];

    while (currentIndex < queryIds.length) {
      const workerPromises = [];
      const batchSize = Math.min(maxThreads, queryIds.length - currentIndex);
      for (let i = 0; i < batchSize; i++) {
        const worker = new Worker(__filename, {
          workerData: {
            hasIDAPI,
            queryId: queryIds[currentIndex],
            accountIndex: currentIndex,
            proxy: proxies[currentIndex % proxies.length],
          },
        });

        workerPromises.push(
          new Promise((resolve) => {
            worker.on("message", (message) => {
              if (message === "taskComplete") {
                worker.terminate();
              }
              // console.log(`message: ${message}`);
              resolve();
            });
            worker.on("error", (error) => {
              console.log(`Lỗi worker cho tài khoản ${currentIndex}: ${error.message}`);
              worker.terminate();
              resolve();
            });
            worker.on("exit", (code) => {
              worker.terminate();
              if (code !== 0) {
                errors.push(`Worker cho tài khoản ${currentIndex} thoát với mã: ${code}`);
              }
              resolve();
            });
          })
        );

        currentIndex++;
      }

      await Promise.all(workerPromises);

      if (errors.length > 0) {
        errors.length = 0;
      }

      if (currentIndex < queryIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    await sleep(3);
    console.log(`=============Hoàn thành tất cả tài khoản | Chờ ${settings.TIME_SLEEP} phút=============`.magenta);
    await sleep(settings.TIME_SLEEP * 60);
  }
}

if (isMainThread) {
  main().catch((error) => {
    console.log("Lỗi rồi:", error);
    process.exit(1);
  });
} else {
  runWorker(workerData);
}
